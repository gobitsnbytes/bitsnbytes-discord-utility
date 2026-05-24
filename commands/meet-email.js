const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = {
	data: new SlashCommandBuilder()
		.setName('meet-email')
		.setDescription('Manage your email configuration for meeting invitations.')
		.addSubcommand(subcommand =>
			subcommand
				.setName('set')
				.setDescription('Set or update your email address.')
				.addStringOption(option =>
					option
						.setName('email')
						.setDescription('Your email address')
						.setRequired(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName('remove')
				.setDescription('Remove your registered email address.'))
		.addSubcommand(subcommand =>
			subcommand
				.setName('status')
				.setDescription('Check your current email registration status.')),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		// Always make email configuration private (ephemeral)
		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			const userId = interaction.user.id;

			if (subcommand === 'set') {
				const email = interaction.options.getString('email').trim().toLowerCase();

				if (!EMAIL_REGEX.test(email)) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} Invalid email address format. Please enter a valid email.`
					});
				}

				await meetingsDb.setUserEmail(userId, email);

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.success} EMAIL_CONFIGURED`)
					.setDescription('Your email has been registered for meeting invites.')
					.addFields(
						{ name: '👤 USER', value: `<@${userId}>`, inline: true },
						{ name: '📧 EMAIL ADDRESS', value: `\`${email}\``, inline: true }
					)
					.setColor(config.COLORS.success)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				return await interaction.editReply({ embeds: [embed] });
			}

			if (subcommand === 'remove') {
				const currentEmail = await meetingsDb.getUserEmail(userId);

				if (!currentEmail) {
					return await interaction.editReply({
						content: `${config.EMOJIS.warning} You do not have an email registered.`
					});
				}

				await meetingsDb.removeUserEmail(userId);

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.success} EMAIL_REMOVED`)
					.setDescription('Your registered email address has been removed.')
					.setColor(config.COLORS.neutral)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				return await interaction.editReply({ embeds: [embed] });
			}

			if (subcommand === 'status') {
				const currentEmail = await meetingsDb.getUserEmail(userId);

				const embed = new EmbedBuilder()
					.setTitle(`⚙️ EMAIL_STATUS`)
					.setColor(currentEmail ? config.COLORS.primary : config.COLORS.neutral)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				if (currentEmail) {
					embed.setDescription(`Your account has a registered email address.`)
						.addFields(
							{ name: '📧 REGISTERED EMAIL', value: `\`${currentEmail}\``, inline: false },
							{ name: '🔔 PREFERENCES', value: 'Receiving invitations, updates, and 30m reminders.', inline: false }
						);
				} else {
					embed.setDescription('No email registered. You will not receive meeting invites or calendar attachments.')
						.addFields({ name: '📝 REGISTRATION', value: 'Use `/meet-email set email:<your-email>` to register.', inline: false });
				}

				return await interaction.editReply({ embeds: [embed] });
			}
		} catch (error) {
			console.error('[MEET_EMAIL_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to process email configuration.`
			});
		}
	}
};
