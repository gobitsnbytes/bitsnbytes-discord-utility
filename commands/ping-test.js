const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping-test')
		.setDescription('Test command to verify registration is working'),

	async execute(interaction) {
		await interaction.reply({
			content: '✅ Registration Complete - Command system working!',
			flags: [MessageFlags.Ephemeral],
		});
	},
};