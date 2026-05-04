const { Events, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const logger = require('../lib/logger');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (interaction.isChatInputCommand()) {
			const command = interaction.client.commands.get(interaction.commandName);

			if (!command) {
				logger.error(`No command matching ${interaction.commandName} was found.`);
				return;
			}

			try {
				await command.execute(interaction);
				logger.command(interaction, 'SUCCESS');
			} catch (error) {
				logger.command(interaction, 'ERROR', error);
				
				const errorEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.error} Protocol Breach`)
					.setDescription('A system error has occurred during synchronization. Please contact a network administrator.')
					.setColor(config.COLORS.error)
					.setFooter({ text: config.BRANDING.footerText });
				
				try {
					// Check if the interaction is still valid/repliable
					if (!interaction.isRepliable()) return;

					if (interaction.replied || interaction.deferred) {
						await interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => null);
					} else {
						await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => null);
					}
				} catch (innerError) {
					logger.error('Critical: Could not send error response to user', innerError);
				}
			}
		} else if (interaction.isModalSubmit()) {
			// Handle Modal Submissions if any (future use)
		}
	},
};
