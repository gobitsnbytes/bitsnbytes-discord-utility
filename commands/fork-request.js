const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('fork-request')
		.setDescription('Request to start a new Bits&Bytes fork in your city.'),
	async execute(interaction) {
		const embed = new EmbedBuilder()
			.setTitle('💾 Initializing New Fork Request...')
			.setDescription("ready to host your own node? click the button below to fill out the official **Bits&Bytes** fork registry form. let's build something epic! ⚡️")
			.setColor('#3498DB')
			.addFields(
				{ name: 'Step 1', value: 'Click the "Open Form" button below.', inline: true },
				{ name: 'Step 2', value: 'Complete the Notion form.', inline: true },
				{ name: 'Step 3', value: 'Our team will reach out on Discord! 🛰️', inline: true }
			)
			.setFooter({ text: 'Bits&Bytes Protocol | Fork Registry', iconURL: interaction.guild.iconURL() })
			.setTimestamp();

		const button = new ButtonBuilder()
			.setLabel('Open Form ↗️')
			.setURL('https://perfect-dinghy-781.notion.site/33a49ed2fc33800984e7c28ca3d7cd2a?pvs=105')
			.setStyle(ButtonStyle.Link);

		const row = new ActionRowBuilder()
			.addComponents(button);

		await interaction.reply({
			embeds: [embed],
			components: [row],
			flags: [MessageFlags.Ephemeral]
		});
	},
};
