const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('forks')
		.setDescription('View technical topology of the Bits&Bytes network.'),

	async execute(interaction) {
        const teamRoleId = '1490410540361580554';
        const member = await interaction.guild.members.fetch(interaction.user.id);
        
        if (!member.roles.cache.has(teamRoleId)) {
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

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} NODE_TOPOLOGY // NET_STATUS_RECAP`)
				.setColor(config.COLORS.primary)
                .setTimestamp()
                .setFooter({ text: config.BRANDING.footerText });

            if (config.UI.useServerIcon) {
                embed.setThumbnail(interaction.guild.iconURL());
            }

            // Signal Readout Formatting
            let activeList = active.map(f => {
                const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
                             f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
                             'UNKNOWN').toUpperCase();
                const leadId = f.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
                const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
                
                const label = `${config.EMOJIS.node} [${city}]`.padEnd(22, '.');
                const leadDisplay = leadId ? `<@${leadId}>` : (leadName || 'ANONYMOUS');
                
                return `\`${label}\` ${config.EMOJIS.active} **ONLINE** // ${leadDisplay}`;
            }).join('\n') || '`NO_ACTIVE_PROTOCOLS_FOUND`';

            let pendingList = pending.map(f => {
                const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
                             f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
                             'PENDING').toUpperCase();
                const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
                
                const label = `${config.EMOJIS.node} [${city}]`.padEnd(22, '.');
                const leadDisplay = leadName ? `(${leadName})` : '';
                
                return `\`${label}\` ${config.EMOJIS.pending} **DISCOVERY** ${leadDisplay}`;
            }).join('\n') || '`NO_PENDING_SYNCHRONIZATIONS`';

            embed.addFields(
                { name: '⚛️ ACTIVE_PROTOCOLS', value: activeList },
                { name: '⏳ NETWORK_DISCOVERY', value: pendingList }
            );

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[TOPOLOGY_ERROR]', error);
			await interaction.editReply({ content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to synchronize topology map.` });
		}
	},
};
