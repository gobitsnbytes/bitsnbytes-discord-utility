const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('view-forks')
		.setDescription('View the active Bits&Bytes network.'),

	async execute(interaction) {
		const flags = config.PRIVACY['view-forks'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const forks = await notion.getForks();
            
            const active = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} BITS&BYTES // NETWORK_NODES`)
				.setDescription('The protocol is live in the following cities. Click a Lead to connect.')
				.setColor(config.COLORS.primary)
                .setTimestamp()
                .setFooter({ text: config.BRANDING.footerText });

            if (config.UI.useServerIcon) {
                embed.setThumbnail(interaction.guild.iconURL());
            }

            const activeList = active.map(f => {
                const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
                             f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
                             'UNKNOWN').toUpperCase();
                const leadId = f.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
                const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
                
                const label = `${config.EMOJIS.node} [${city}]`.padEnd(22, '.');
                const leadDisplay = leadId ? `<@${leadId}>` : (leadName || 'ANONYMOUS');
                
                return `\`${label}\` ${leadDisplay}`;
            }).join('\n') || '`NO_ACTIVE_PROTOCOLS_FOUND`';

            embed.addFields({ name: '🌐 SYNCHRONIZED_NODES', value: activeList });

			await interaction.editReply({ 
                embeds: [embed],
                allowedMentions: { parse: [] } // SILENT_MENTIONS: Prevents annoying pings for Leads
            });
		} catch (error) {
			console.error('[NETWORK_VIEW_ERROR]', error);
			await interaction.editReply({ content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to synchronize network map.` });
		}
	},
};
