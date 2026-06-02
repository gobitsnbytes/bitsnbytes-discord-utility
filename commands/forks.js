const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('forks')
		.setDescription('View technical topology of the Bits&Bytes network.'),

	async execute(interaction) {
		const { isStaff } = require('../lib/auth');
		const member = await interaction.guild.members.fetch(interaction.user.id);
		
		const isAuthorized = member.roles.cache.has(config.ROLE_IDS.contributor) || isStaff(member, interaction.guild) || member.permissions.has('Administrator');
		
		if (!isAuthorized) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
				.setDescription('Your credentials do not grant access to internal network topology.')
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			return await interaction.reply({ 
				embeds: [unauthorizedEmbed], 
				flags: [MessageFlags.Ephemeral] 
			});
		}

		const flags = config.PRIVACY.forks ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const forks = await notion.getForks();
            
            // Filter out "ghost" records (rows that have a status but no city or name data)
            const isValidFork = (f) => {
                const city = f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content;
                const name = f.properties?.["Fork Name"]?.title?.[0]?.text?.content;
                const altCity = f.properties?.City?.rich_text?.[0]?.text?.content;
                return city || name || altCity;
            };

            const active = forks
                .filter(isValidFork)
                .filter(f => f.properties?.Status?.select?.name === 'Active');
            
            const pending = forks
                .filter(isValidFork)
                .filter(f => f.properties?.Status?.select?.name === 'Pending');



            // Signal Readout Formatting
            const resolvedActiveMembers = await Promise.all(
                active.map(async f => {
                    const leadId = f.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
                    if (!leadId) return null;
                    try {
                        return await interaction.guild.members.fetch(leadId);
                    } catch (err) {
                        return null;
                    }
                })
            );

            const activeLines = active.map((f, index) => {
                const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
                             f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
                             'UNKNOWN').toUpperCase();
                const leadId = f.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
                const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
                
                const label = `${config.EMOJIS.node} [${city}]`.padEnd(22, '.');
                
                let leadDisplay;
                if (leadId) {
                    const member = resolvedActiveMembers[index];
                    const displayName = member ? member.displayName : leadName;
                    leadDisplay = displayName ? `${displayName} (<@${leadId}>)` : `<@${leadId}>`;
                } else {
                    leadDisplay = leadName || 'ANONYMOUS';
                }
                
                return `\`${label}\` ${config.EMOJIS.active} **ONLINE** // ${leadDisplay}`;
            });

            const pendingLines = pending.map(f => {
                const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
                             f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
                             'PENDING').toUpperCase();
                const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
                
                const label = `${config.EMOJIS.node} [${city}]`.padEnd(22, '.');
                const leadDisplay = leadName ? `(${leadName})` : '';
                
                return `\`${label}\` ${config.EMOJIS.pending} **DISCOVERY** ${leadDisplay}`;
            });

            const pages = [];
            const pageSize = 10;
            const maxPages = Math.max(
                Math.ceil(activeLines.length / pageSize),
                Math.ceil(pendingLines.length / pageSize),
                1
            );

            for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
                const activeChunk = activeLines.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize);
                const pendingChunk = pendingLines.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize);

                const activeList = activeChunk.join('\n') || '`NO_ACTIVE_PROTOCOLS_FOUND`';
                const pendingList = pendingChunk.join('\n') || '`NO_PENDING_SYNCHRONIZATIONS`';

                const embed = new EmbedBuilder()
                    .setTitle(`${config.EMOJIS.protocol} NODE_TOPOLOGY // NET_STATUS_RECAP`)
                    .setColor(config.COLORS.primary)
                    .addFields(
                        { name: `⚛️ ACTIVE_PROTOCOLS (Part ${pageIdx + 1}/${maxPages})`, value: activeList },
                        { name: `⏳ NETWORK_DISCOVERY (Part ${pageIdx + 1}/${maxPages})`, value: pendingList }
                    )
                    .setTimestamp()
                    .setFooter({ text: config.BRANDING.footerText });

                if (config.UI.useServerIcon) {
                    embed.setThumbnail(interaction.guild.iconURL());
                }

                pages.push(embed);
            }

            const { paginate } = require('../lib/pagination');
            await paginate(interaction, pages, config.PRIVACY.forks);

		} catch (error) {
			console.error('[TOPOLOGY_ERROR]', error);
			await interaction.editReply({ content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to synchronize topology map.` });
		}
	},
};
