const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const teamValidator = require('../lib/teamValidator');
const config = require('../config');
const auth = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('team-view')
		.setDescription('View fork team structure')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Specific fork city (leave empty for all)')
				.setRequired(false)),

	async execute(interaction) {
		const flags = config.PRIVACY['team-view'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			let city = interaction.options.getString('city');
			const member = interaction.member;
			const isGlobal = auth.isExecutiveLeader(member) || auth.isDepartmentLead(member) || auth.isParentTrackContributor(member);

			if (!city) {
				if (isGlobal) {
					// Fall through to the network overview
				} else {
					const userCity = auth.getMemberCity(member);
					if (userCity) {
						city = userCity;
					} else {
						const unauthorizedEmbed = new EmbedBuilder()
							.setTitle(`❌ PROTOCOL_UNAUTHORIZED`)
							.setDescription('Your credentials do not grant access to view overall network team summaries. Please specify a city.')
							.setColor(config.COLORS.error)
							.setFooter({ text: config.BRANDING.footerText });
						return await interaction.editReply({ embeds: [unauthorizedEmbed] });
					}
				}
			}

			if (city) {
				const isAuthorized = await auth.isAuthorizedForCity(interaction.user, city, interaction.guild, 'view');
				if (!isAuthorized) {
					const unauthorizedEmbed = new EmbedBuilder()
						.setTitle(`❌ PROTOCOL_UNAUTHORIZED`)
						.setDescription(`Your credentials do not grant access to view structure for the **${city.toUpperCase()}** node.`)
						.setColor(config.COLORS.error)
						.setFooter({ text: config.BRANDING.footerText });
					return await interaction.editReply({ embeds: [unauthorizedEmbed] });
				}
				const fork = await notion.findForkByCity(city);
				if (!fork) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} Fork not found: ${city}`,
					});
				}

				const forkId = fork.id;
				const teamMembers = await notion.getTeamMembers(forkId);
				const validation = teamValidator.validateTeam(teamMembers);

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} TEAM_STRUCTURE // ${city.toUpperCase()}`)
					.setColor(validation.isValid ? config.COLORS.success : config.COLORS.warning)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				// Team display
				const teamDisplay = teamValidator.formatTeamDisplay(teamMembers);
				embed.addFields({
					name: '👥 TEAM_MEMBERS',
					value: teamDisplay,
					inline: false,
				});

				// Validation status
				if (validation.isValid) {
					embed.addFields({
						name: '✅ VALIDATION_STATUS',
						value: 'Team structure is valid. All required roles filled.',
						inline: false,
					});
				} else {
					if (validation.issues.length > 0) {
						embed.addFields({
							name: '❌ CRITICAL_ISSUES',
							value: validation.issues.map(i => `• ${i.message}`).join('\n'),
							inline: false,
						});
					}
					if (validation.warnings.length > 0) {
						embed.addFields({
							name: '⚠️ WARNINGS',
							value: validation.warnings.map(w => `• ${w.message}`).join('\n'),
							inline: false,
						});
					}
				}

				// Stats
				const stats = teamValidator.getTeamStats(teamMembers);
				embed.addFields({
					name: '📊 TEAM_STATS',
					value: `Members: ${stats.totalMembers}\nCompleteness: ${stats.completeness}%\nAssignments: ${stats.totalAssignments}`,
					inline: false,
				});

				await interaction.editReply({ embeds: [embed] });
			} else {
				// All forks view
				const forks = await notion.getForks();
				const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

				if (activeForks.length === 0) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} No active forks found.`,
					});
				}

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} NETWORK_TEAM_OVERVIEW`)
					.setColor(config.COLORS.primary)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				let overviewText = '';

				const activeSlice = activeForks.slice(0, 10);
				const overviewLines = new Array(activeSlice.length);
				const tasks = activeSlice.map((fork, idx) => async () => {
					const forkCity = (fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
					                  fork.properties['Fork Name']?.title?.[0]?.text?.content || 
					                  'UNKNOWN').toUpperCase();
					const teamMembers = await notion.getTeamMembers(fork.id);
					const validation = teamValidator.validateTeam(teamMembers);

					const statusEmoji = validation.isValid ? '✅' : '⚠️';
					const missingText = validation.missingRoles.length > 0 
						? ` (Missing: ${validation.missingRoles.join(', ')})`
						: '';

					overviewLines[idx] = `${statusEmoji} **${forkCity}**: ${validation.completeness}% complete${missingText}\n`;
				});

				await notion.limitConcurrency(tasks, 3);
				overviewText = overviewLines.join('');

				embed.addFields({
					name: '📊 FORK_TEAMS',
					value: overviewText || 'No teams configured',
					inline: false,
				});

				await interaction.editReply({ embeds: [embed] });
			}

		} catch (error) {
			console.error('[TEAM_VIEW_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to retrieve team data.`,
			});
		}
	},
};