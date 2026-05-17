const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('archive')
		.setDescription('Mark a fork as stale and archive it.')
		.addStringOption(option => option.setName('city').setDescription('The city for the fork').setRequired(true))
		.addStringOption(option => option.setName('reason').setDescription('The reason for archival').setRequired(true))
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

	async execute(interaction) {
		const city = interaction.options.getString('city');
		const reason = interaction.options.getString('reason');
		const guild = interaction.guild;

		const flags = config.PRIVACY.archive ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			// 1. Find the fork by city
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				throw new Error(`Could not find a fork for city "${city}" in Notion.`);
			}

            // 2. Remove @fork-lead role
            const forkLeadId = fork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
            if (forkLeadId) {
                const forkLeadRole = guild.roles.cache.find(r => r.name === 'fork-lead');
                if (forkLeadRole) {
                    const member = await guild.members.fetch(forkLeadId).catch(() => null);
                    if (member) await member.roles.remove(forkLeadRole);
                }
            }

			// 3. Delete city channel
			const baseChannelName = city.toLowerCase().replace(/\s+/g, '-');
			const cityChannel = guild.channels.cache.find(c => 
				c.name === baseChannelName || 
				c.name === `gobitsnbytes-${baseChannelName}` ||
				c.name === `${baseChannelName}-archived` ||
				c.name === `gobitsnbytes-${baseChannelName}-archived`
			);
			if (cityChannel) {
				await cityChannel.delete(`Fork for ${city} archived/decommissioned.`);
			}

			// 4. Update Notion status
			await notion.updateForkStatus(fork.id, 'Archived');

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.archived} PROTOCOL ARCHIVAL: SUCCESSFUL`)
				.setDescription(`The fork for **${city}** has been decommissioned and archived.`)
				.addFields(
					{ name: 'REASON', value: reason }
				)
				.setColor(config.COLORS.neutral)
				.setThumbnail(interaction.guild.iconURL())
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[ARCHIVE] Error:', error);
			await interaction.editReply('❌ There was an error while archiving the fork.');
		}
	},
};
