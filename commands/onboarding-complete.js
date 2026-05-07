const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('onboarding-complete')
		.setDescription('Staff command: Mark onboarding step(s) complete')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('steps')
				.setDescription('Steps to mark complete')
				.setRequired(true)),

	async execute(interaction) {
		await interaction.reply({
			content: '✅ Onboarding complete command is working! (Test mode)',
			flags: [MessageFlags.Ephemeral],
		});
	},
};