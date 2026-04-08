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
            
            const active = forks.filter(f => f.properties.Status.select.name === 'Active');
            const pending = forks.filter(f => f.properties.Status.select.name === 'Pending');

			const embed = new EmbedBuilder()
				.setTitle('🍴 Active Bits&Bytes Forks')
				.setColor('#3498DB')
                .setTimestamp();

            let activeList = active.map(f => {
                const city = f.properties.City.rich_text[0]?.text?.content;
                const leadId = f.properties['Discord ID']?.rich_text[0]?.text?.content;
                return `bitsnbytes-${city.toLowerCase()}  →  <@${leadId}>  (active)`;
            }).join('\n');

            let pendingList = pending.map(f => {
                const city = f.properties.City.rich_text[0]?.text?.content;
                return `bitsnbytes-${city.toLowerCase()}  →  pending`;
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
