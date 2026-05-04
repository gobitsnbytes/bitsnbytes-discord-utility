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
				// Check if the command already replied/deferred and if it's considered a success
				// If the command caught its own error and edited the reply, it might still reach here.
				// We'll trust the command.execute to throw if it's a true failure.
				logger.command(interaction, 'SUCCESS');
			} catch (error) {
				// Don't log "Interaction has already been acknowledged" as a command error if it's just a duplicate process
				if (error.code === 40060) {
					logger.warn(`Interaction already acknowledged (likely duplicate process): ${interaction.commandName}`);
					return;
				}

				logger.command(interaction, 'ERROR', error);
				
				const errorEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.error} Protocol Breach`)
					.setDescription(error.message || 'A system error has occurred during synchronization.')
					.setColor(config.COLORS.error)
					.setFooter({ text: config.BRANDING.footerText });
				
				try {
					if (!interaction.isRepliable()) return;

					if (interaction.replied || interaction.deferred) {
						await interaction.editReply({ embeds: [errorEmbed], content: null }).catch(() => {
							// If editReply fails, try followUp as a last resort
							return interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => null);
						});
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
