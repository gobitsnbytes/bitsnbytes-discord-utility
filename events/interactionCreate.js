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
				logger.command(interaction, 'EXECUTE');
				await command.execute(interaction);
			} catch (error) {
				logger.command(interaction, 'ERROR', error);
				
				const errorEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.error} Protocol Breach`)
					.setDescription('A system error has occurred during synchronization. Please contact a network administrator.')
					.setColor(config.COLORS.error)
					.setFooter({ text: config.BRANDING.footerText });
				
				try {
					if (interaction.replied || interaction.deferred) {
						await interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
					} else {
						await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
					}
				} catch (innerError) {
					logger.error('Could not send error reply', innerError);
				}
			}
		} else if (interaction.isModalSubmit()) {
			// Handle Modal Submissions if any (future use)
		}
	},
};
