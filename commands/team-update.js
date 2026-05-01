const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const teamValidator = require('../lib/teamValidator');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('team-update')
		.setDescription('Update fork team members')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(true))
		.addUserOption(option =>
			option
				.setName('member')
				.setDescription('Discord user to add/remove')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('role')
				.setDescription('Role to assign')
				.setRequired(true)
				.addChoices(
					{ name: '🎯 Tech Lead', value: 'Tech Lead' },
					{ name: '🎨 Creative Lead', value: 'Creative Lead' },
					{ name: '📋 Ops Lead', value: 'Ops Lead' },
					{ name: '🤝 Volunteer', value: 'Volunteer' },
					{ name: '👤 Member', value: 'Member' },
				))
		.addStringOption(option =>
			option
				.setName('action')
				.setDescription('Add or remove member')
				.setRequired(true)
				.addChoices(
					{ name: 'Add', value: 'add' },
					{ name: 'Remove', value: 'remove' },
				)),

	async execute(interaction) {
		const flags = config.PRIVACY['team-update'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const city = interaction.options.getString('city');
			const member = interaction.options.getUser('member');
			const role = interaction.options.getString('role');
			const action = interaction.options.getString('action');

			// Find the fork
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Fork not found: ${city}`,
				});
			}

			const forkId = fork.id;
			const discordId = member.id;
			const memberName = member.username;

			if (action === 'add') {
				// Check if member already exists in this fork
				const existingMember = await notion.findTeamMember(forkId, discordId);
				if (existingMember) {
					// Member exists - update their role instead of creating duplicate
					const existingRole = existingMember.properties.Role?.select?.name;
					if (existingRole === role) {
						return await interaction.editReply({
							content: `${config.EMOJIS.warning} <@${discordId}> already has the **${role}** role in ${city}.`,
						});
					}
					// Update existing member's role
					await notion.updateTeamMember(existingMember.id, role, memberName);
				} else {
					// New member - add to team
					await notion.addTeamMember(forkId, discordId, role, memberName);
				}

				// Update team completeness score
				await notion.computeAndUpdateTeamCompleteness(forkId);

				// Get updated team for validation
				const teamMembers = await notion.getTeamMembers(forkId);
				const validation = teamValidator.validateTeam(teamMembers);

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} TEAM_UPDATE // ${city.toUpperCase()}`)
					.setColor(config.COLORS.success)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				embed.addFields({
					name: '✅ MEMBER_ADDED',
					value: `${teamValidator.getRoleEmoji(role)} <@${discordId}> as **${role}**`,
					inline: false,
				});

				// Show validation status
				if (validation.missingRoles.length > 0) {
					embed.addFields({
						name: '⚠️ MISSING_ROLES',
						value: validation.missingRoles.map(r => `${teamValidator.getRoleEmoji(r)} ${r}`).join('\n'),
						inline: false,
					});
				} else {
					embed.addFields({
						name: '✅ TEAM_STATUS',
						value: 'All required roles filled! Team is complete.',
						inline: false,
					});
				}

				embed.addFields({
					name: '📊 TEAM_COMPLETENESS',
					value: `${validation.completeness}% (${validation.filledRoles}/${validation.totalRequiredRoles} required roles)`,
					inline: false,
				});

				await interaction.editReply({ embeds: [embed] });

			} else if (action === 'remove') {
				// Find and remove the team member
				const existingMember = await notion.findTeamMember(forkId, discordId);
				if (!existingMember) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} <@${discordId}> is not a team member of ${city}.`,
					});
				}

				await notion.removeTeamMember(existingMember.id);

				// Update team completeness score
				await notion.computeAndUpdateTeamCompleteness(forkId);

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} TEAM_UPDATE // ${city.toUpperCase()}`)
					.setColor(config.COLORS.warning)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				embed.addFields({
					name: '🗑️ MEMBER_REMOVED',
					value: `<@${discordId}> removed from team`,
					inline: false,
				});

				await interaction.editReply({ embeds: [embed] });
			}

		} catch (error) {
			console.error('[TEAM_UPDATE_ERROR]', error);
			
			if (error.message.includes('NOTION_TEAM_DB not configured')) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Team database not configured. Please set NOTION_TEAM_DB in environment.`,
				});
			}

			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to update team.`,
			});
		}
	},
};