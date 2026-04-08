const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('forks')
		.setDescription('List all active and pending Bits&Bytes forks.'),

	async execute(interaction) {
		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			const forks = await notion.getForks();
            
            // Filter out "ghost" records (rows that have a status but no city or name data)
            const isValidFork = (f) => {
                const city = f.properties?.City?.rich_text?.[0]?.text?.content;
                const name = f.properties?.Name?.title?.[0]?.text?.content;
                return city || name; // Must have at least one identifying string
            };

            const active = forks
                .filter(isValidFork)
                .filter(f => f.properties?.Status?.select?.name === 'Active');
            
            const pending = forks
                .filter(isValidFork)
                .filter(f => f.properties?.Status?.select?.name === 'Pending');

			const embed = new EmbedBuilder()
				.setTitle('🍴 Active Bits&Bytes Forks')
				.setColor('#3498DB')
                .setTimestamp();

            let activeList = active.map(f => {
                const city = f.properties?.City?.rich_text?.[0]?.text?.content || 
                             f.properties?.Name?.title?.[0]?.text?.content || 
                             'Unknown';
                
                const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
                const leadId = f.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
                
                // Use Lead Name if Discord ID is missing
                const leadDisplay = leadId ? `<@${leadId}>` : (leadName || 'unknown lead');
                
                return `bitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}  →  ${leadDisplay}  (active)`;
            }).join('\n');

            let pendingList = pending.map(f => {
                const city = f.properties?.City?.rich_text?.[0]?.text?.content || 
                             f.properties?.Name?.title?.[0]?.text?.content || 
                             'Pending';
                
                const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
                const leadDisplay = leadName ? `(${leadName})` : '';
                
                return `bitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}  →  pending ${leadDisplay}`;
            }).join('\n');

            if (activeList) embed.addFields({ name: 'Active', value: activeList });
            if (pendingList) embed.addFields({ name: 'Pending', value: pendingList });
            
            embed.setFooter({ text: `Total: ${active.length} active | ${pending.length} pending` });

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[FORKS] Error:', error);
			await interaction.editReply('❌ There was an error while fetching the forks list.');
		}
	},
};
