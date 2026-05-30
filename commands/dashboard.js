const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('dashboard')
		.setDescription('Manage your scheduling availability and booking handle.'),

	async execute(interaction) {
		const flags = config.PRIVACY.dashboard ? [MessageFlags.Ephemeral] : [];
		
		const embed = new EmbedBuilder()
			.setTitle(`${config.EMOJIS.website} HOST_DASHBOARD`)
			.setDescription('Configure when guests can book calls with you.')
			.addFields(
				{ name: '⚙️ Setup', value: 'Use the link below to set your weekly hours, select your local timezone, and update your bio.', inline: false },
				{ name: '📅 Calendar Sync', value: 'Meetings booked through your link are automatically added to the Google Calendar.', inline: false }
			)
			.setColor(config.COLORS.primary)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		const button = new ButtonBuilder()
			.setLabel('Open Dashboard')
			.setURL('https://cal.gobitsnbytes.org/dashboard')
			.setStyle(ButtonStyle.Link);

		const row = new ActionRowBuilder().addComponents(button);

		await interaction.reply({
			embeds: [embed],
			components: [row],
			flags: flags
		});
	},
};
