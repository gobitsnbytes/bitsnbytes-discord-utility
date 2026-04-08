const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('pulse')
		.setDescription('Submit a structured activity update for your fork.')
		.addStringOption(option => option.setName('city').setDescription('The city for the fork').setRequired(true))
		.addStringOption(option => option.setName('update').setDescription('The update details (text)').setRequired(true)),

	async execute(interaction) {
		const city = interaction.options.getString('city');
		const updateText = interaction.options.getString('update');
		const guild = interaction.guild;

        // Check if @fork-lead
        const member = await guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.some(r => r.name === 'fork-lead')) {
            return await interaction.reply({ content: "🚫 This command is only for @fork-lead users.", flags: [MessageFlags.Ephemeral] });
        }

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			// 1. Post to #pulse
			const pulseChannel = guild.channels.cache.find(c => c.name === 'pulse');
			if (pulseChannel) {
				const pulseEmbed = new EmbedBuilder()
					.setTitle(`📡 Fork Pulse — Bitsnbytes-${city.toLowerCase()}`)
					.addFields(
						{ name: 'Lead', value: `<@${interaction.user.id}>`, inline: true },
						{ name: 'Update', value: updateText },
						{ name: 'Date', value: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
					)
					.setColor('#2ECC71');

				await pulseChannel.send({ embeds: [pulseEmbed] });
			}

			// 2. Update Notion
			const fork = await notion.findForkByCity(city);
			if (fork) {
				await notion.updatePulse(fork.id, new Date().toISOString());
			}

			await interaction.editReply(`✅ Successfully posted pulse update for **${city}**.`);

		} catch (error) {
			console.error('[PULSE] Error:', error);
			await interaction.editReply('❌ There was an error while posting your pulse update.');
		}
	},
};
