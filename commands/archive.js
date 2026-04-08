const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');

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

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			// 1. Find the fork by city
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				return await interaction.editReply(`❌ Fork for **${city}** not found in registry.`);
			}

            // 2. Remove @fork-lead role
            const forkLeadId = fork.properties['Discord ID']?.rich_text[0]?.text?.content;
            if (forkLeadId) {
                const forkLeadRole = guild.roles.cache.find(r => r.name === 'fork-lead');
                if (forkLeadRole) {
                    try {
                        const member = await guild.members.fetch(forkLeadId);
                        await member.roles.remove(forkLeadRole);
                    } catch (e) {
                        console.log(`[ARCHIVE] Could not remove role from user ${forkLeadId}. Maybe they left?`);
                    }
                }
            }

			// 3. Rename and lock channel
			const channelName = city.toLowerCase().replace(/\s+/g, '-');
			const cityChannel = guild.channels.cache.find(c => c.name === channelName);
			if (cityChannel) {
				await cityChannel.setName(`${channelName}-archived`);
				await cityChannel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
			}

			// 4. Post to #pulse
			const pulseChannel = guild.channels.cache.find(c => c.name === 'pulse');
			if (pulseChannel) {
				const pulseEmbed = new EmbedBuilder()
					.setTitle(`🗃️ Bitsnbytes-${city.toLowerCase()} has been archived`)
					.addFields(
						{ name: 'Reason', value: reason },
						{ name: 'Recovery', value: 'The branch can be revived — reach out to hello@gobitsnbytes.org' },
					)
					.setColor('#E74C3C');

				await pulseChannel.send({ embeds: [pulseEmbed] });
			}

			// 5. Update Notion
			await notion.updateForkStatus(fork.id, 'Archived');

			await interaction.editReply(`✅ Successfully archived fork for **${city}**.`);

		} catch (error) {
			console.error('[ARCHIVE] Error:', error);
			await interaction.editReply('❌ There was an error while archiving the fork.');
		}
	},
};
