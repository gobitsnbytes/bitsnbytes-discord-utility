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

            if (active.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle(`${config.EMOJIS.protocol} BITS&BYTES // NETWORK_NODES`)
                    .setDescription('The protocol is live in the following cities. Click a Lead to connect.')
                    .setColor(config.COLORS.primary)
                    .addFields({ name: '🌐 SYNCHRONIZED_NODES', value: '`NO_ACTIVE_PROTOCOLS_FOUND`' })
                    .setTimestamp()
                    .setFooter({ text: config.BRANDING.footerText });
                if (config.UI.useServerIcon) {
                    embed.setThumbnail(interaction.guild.iconURL());
                }
                return await interaction.editReply({ embeds: [embed] });
            }

            const pages = [];
            const pageSize = 10;
            const totalPages = Math.ceil(active.length / pageSize);

            for (let i = 0; i < active.length; i += pageSize) {
                const chunk = active.slice(i, i + pageSize);
                const pageNum = Math.floor(i / pageSize) + 1;

                // Pre-fetch all members in the current chunk from the guild cache or Discord API to resolve display names
                const resolvedMembers = await Promise.all(
                    chunk.map(async f => {
                        const leadId = f.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
                        if (!leadId) return null;
                        try {
                            return await interaction.guild.members.fetch(leadId);
                        } catch (err) {
                            return null;
                        }
                    })
                );

                const activeList = chunk.map((f, index) => {
                    const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
                                 f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
                                 'UNKNOWN').toUpperCase();
                    const leadId = f.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
                    const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
                    
                    const label = `${config.EMOJIS.node} [${city}]`.padEnd(22, '.');
                    
                    let leadDisplay;
                    if (leadId) {
                        const member = resolvedMembers[index];
                        const displayName = member ? member.displayName : leadName;
                        leadDisplay = displayName ? `${displayName} (<@${leadId}>)` : `<@${leadId}>`;
                    } else {
                        leadDisplay = leadName || 'ANONYMOUS';
                    }
                    
                    return `\`${label}\` ${leadDisplay}`;
                }).join('\n');

                const embed = new EmbedBuilder()
                    .setTitle(`${config.EMOJIS.protocol} BITS&BYTES // NETWORK_NODES`)
                    .setDescription('The protocol is live in the following cities. Click a Lead to connect.')
                    .setColor(config.COLORS.primary)
                    .addFields({ name: `🌐 SYNCHRONIZED_NODES (Part ${pageNum}/${totalPages})`, value: activeList })
                    .setTimestamp()
                    .setFooter({ text: config.BRANDING.footerText });

                if (config.UI.useServerIcon) {
                    embed.setThumbnail(interaction.guild.iconURL());
                }

                pages.push(embed);
            }

            const { paginate } = require('../lib/pagination');
            await paginate(interaction, pages, config.PRIVACY['view-forks']);
		} catch (error) {
            console.error('[NETWORK_VIEW_ERROR]', error);
            if (error.message && error.message.includes('NOTION_FORK_REGISTRY_DB not configured')) {
                return await interaction.editReply({ content: `${config.EMOJIS.error} Configuration error: Notion Fork Registry DB not configured. Please set NOTION_FORK_REGISTRY_DB in the environment.` });
            }
            await interaction.editReply({ content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to synchronize network map.` });
		}
	},
};
