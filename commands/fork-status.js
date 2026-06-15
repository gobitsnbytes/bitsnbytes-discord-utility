const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const healthScore = require('../lib/healthScore');
const teamValidator = require('../lib/teamValidator');
const config = require('../config');
const auth = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('fork-status')
		.setDescription('View complete fork status dashboard')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(false)),

	async execute(interaction) {
		const flags = config.PRIVACY['fork-status'] ? [MessageFlags.Ephemeral] : [];
		
		if (!interaction.guild) {
			return await interaction.reply({
				content: `${config.EMOJIS.error} This command can only be executed within a Discord server.`,
				flags: [MessageFlags.Ephemeral]
			});
		}

		await interaction.deferReply({ flags });

		try {
			let city = interaction.options.getString('city');
			const member = interaction.member;
			const isGlobal = auth.isExecutiveLeader(member) || auth.isDepartmentLead(member) || auth.isParentTrackContributor(member);

			if (!city) {
				if (isGlobal) {
					// Fall through to all forks
				} else {
					const userCity = auth.getMemberCity(member);
					if (userCity) {
						city = userCity;
					} else {
						const unauthorizedEmbed = new EmbedBuilder()
							.setTitle(`❌ PROTOCOL_UNAUTHORIZED`)
							.setDescription('Your credentials do not grant access to view overall network dashboards. Please specify a city.')
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
						.setDescription(`Your credentials do not grant access to view status for the **${city.toUpperCase()}** node.`)
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
				const props = fork.properties;

				const health = healthScore.calculateHealthScore(fork);
				const healthStatus = healthScore.getHealthStatus(health.score);
				const [teamMembers, events, reports, onboardingStatus, badges] = await notion.limitConcurrency([
					() => notion.getTeamMembers(forkId),
					() => notion.getEvents(forkId),
					() => notion.getReports(forkId),
					() => notion.getOnboardingStatus(forkId),
					() => notion.getForkBadges(forkId)
				], 3);
				const teamValidation = teamValidator.validateTeam(teamMembers);
				const upcomingEvents = events.filter(e => new Date(e.date) >= new Date());
				const completedEvents = events.filter(e => e.status === 'Completed');

				const leadId = props['Discord ID']?.rich_text?.[0]?.text?.content;
				const leadName = props["What's your name?"]?.rich_text?.[0]?.text?.content;

				const lastPulse = props['Last Pulse']?.date?.start;
				let pulseAgo = 'Never';
				if (lastPulse) {
					const pulseDate = new Date(lastPulse);
					const now = new Date();
					const diffDays = Math.floor((now - pulseDate) / (1000 * 60 * 60 * 24));
					pulseAgo = diffDays === 0 ? 'Today' : `${diffDays} days ago`;
				}

				const partnershipsCount = props['Partnerships Count']?.number || 0;

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} FORK_STATUS // ${city.toUpperCase()}`)
					.setColor(healthStatus.color)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				embed.addFields({
					name: `📊 HEALTH_SCORE: ${health.score}/100`,
					value: `${healthStatus.emoji} ${healthStatus.label}`,
					inline: false,
				});

				const resolvedMembers = await Promise.all(
					teamMembers.map(async m => {
						try {
							return await interaction.guild.members.fetch(m.discordId);
						} catch {
							return null;
						}
					})
				);

				let teamText = '';
				for (const role of teamValidator.REQUIRED_ROLES) {
					const members = teamMembers.filter(m => m.role === role);
					const emoji = teamValidator.getRoleEmoji(role);
					if (members.length > 0) {
						const mentions = members.map(m => {
							const idx = teamMembers.findIndex(tm => tm.discordId === m.discordId);
							const member = resolvedMembers[idx];
							const name = member ? member.displayName : m.name;
							return name ? `${name} (<@${m.discordId}>)` : `<@${m.discordId}>`;
						}).join(', ');
						teamText += `${emoji} **${role}**: ${mentions} ✅\n`;
					} else {
						teamText += `${emoji} **${role}**: ⚠️ MISSING\n`;
					}
				}
				embed.addFields({
					name: '👥 TEAM_STRUCTURE',
					value: teamText || 'No team members assigned',
					inline: false,
				});

				const nextEvent = upcomingEvents.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
				let eventsText = `Upcoming: ${upcomingEvents.length}\nCompleted: ${completedEvents.length}`;
				if (nextEvent) {
					const nextDate = new Date(nextEvent.date).toLocaleDateString();
					eventsText += `\nNext: ${nextEvent.title} on ${nextDate}`;
				}
				embed.addFields({
					name: '📅 EVENTS',
					value: eventsText,
					inline: true,
				});

				embed.addFields({
					name: '🤝 PARTNERSHIPS',
					value: `${partnershipsCount} secured`,
					inline: true,
				});

				const thisQuarterReports = reports.filter(r => {
					const submitted = new Date(r.submittedDate);
					const now = new Date();
					const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
					return submitted >= quarterStart;
				});

				embed.addFields({
					name: '📝 ACTIVITY',
					value: `Last Pulse: ${pulseAgo}\nReports: ${thisQuarterReports.length} this quarter`,
					inline: true,
				});

				const progressBar = onboardingStatus.steps.map(s => s.completed ? '✅' : '⬜').join('');
				embed.addFields({
					name: `✅ ONBOARDING: ${onboardingStatus.progress}/7`,
					value: progressBar,
					inline: false,
				});

				if (badges.length > 0) {
					embed.addFields({
						name: '🏅 BADGES',
						value: badges.join(' '),
						inline: false,
					});
				}

				const alerts = [];
				if (teamValidation.missingRoles.length > 0) {
					alerts.push(`⚠️ Missing roles: ${teamValidation.missingRoles.join(', ')}`);
				}
				if (upcomingEvents.length === 0) {
					const currentMonth = new Date().toLocaleString('default', { month: 'long' });
					alerts.push(`⚠️ No events planned for ${currentMonth}`);
				}
				if (health.score < 40) {
					alerts.push('🚨 Fork is at risk - health score below 40');
				}
				if (onboardingStatus.progress < 7) {
					alerts.push(`⚠️ Onboarding incomplete: ${7 - onboardingStatus.progress} steps remaining`);
				}

				if (alerts.length > 0) {
					embed.addFields({
						name: '⚠️ ALERTS',
						value: alerts.join('\n'),
						inline: false,
					});
				}

				if (leadId) {
					const leadMember = await interaction.guild.members.fetch(leadId).catch(() => null);
					const displayName = leadMember ? leadMember.displayName : leadName;
					embed.addFields({
						name: '👤 FORK_LEAD',
						value: displayName ? `${displayName} (<@${leadId}>)` : `<@${leadId}>`,
						inline: false,
					});
				}

				await interaction.editReply({ embeds: [embed] });
			} else {
				// All forks overview
				const forks = await notion.getForks();
				const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

				if (activeForks.length === 0) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} No active forks found.`,
					});
				}

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} NETWORK_DASHBOARD`)
					.setColor(config.COLORS.primary)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				let networkOverview = '';
				let totalHealth = 0;
				let totalBadges = 0;

				for (const fork of activeForks) {
					const cityName = notion.getCityName(fork) || 'UNKNOWN';
					const health = healthScore.calculateHealthScore(fork);
					const badges = await notion.getForkBadges(fork.id).catch(() => []);
					totalHealth += health.score;
					totalBadges += badges.length;
					networkOverview += `**${cityName.toUpperCase()}**: Health ${health.score}/100 | ${badges.length} badges\n`;
				}

				const avgHealth = Math.round(totalHealth / activeForks.length);

				embed.addFields({
					name: '📊 NETWORK STATS',
					value: `Forks: ${activeForks.length}\nAvg Health: ${avgHealth}/100\nTotal Badges: ${totalBadges}`,
					inline: false,
				});

				embed.addFields({
					name: '📍 OPERATIONAL UNITS',
					value: networkOverview.substring(0, 1000) || 'None',
					inline: false,
				});

				await interaction.editReply({ embeds: [embed] });
			}

		} catch (error) {
			console.error('[FORK_STATUS_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to retrieve fork status.`,
			});
		}
	},
};