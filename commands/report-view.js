const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
const auth = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('report-view')
		.setDescription('View the details (notes and attachments) of submitted fork reports')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(true))
		.addIntegerOption(option =>
			option
				.setName('limit')
				.setDescription('Number of reports to view (default: 5)')
				.setRequired(false)),

	async execute(interaction) {
		const flags = config.PRIVACY['report-view'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const city = interaction.options.getString('city');
			const limit = interaction.options.getInteger('limit') || 5;

			// Enforce authorization check
			const isAuthorized = await auth.isAuthorizedForCity(interaction.user, city, interaction.guild);
			if (!isAuthorized) {
				const unauthorizedEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
					.setDescription(`Your credentials do not grant access to view reports for the **${city.toUpperCase()}** node.`)
					.setColor(config.COLORS.error)
					.setFooter({ text: config.BRANDING.footerText });
				return await interaction.editReply({ embeds: [unauthorizedEmbed] });
			}

			// Find the fork
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Fork not found: ${city}`,
				});
			}

			const reports = await notion.getReports(fork.id);
			if (reports.length === 0) {
				const emptyEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} REPORTS // ${city.toUpperCase()}`)
					.setDescription('No reports have been submitted for this fork node yet.')
					.setColor(config.COLORS.warning)
					.setFooter({ text: config.BRANDING.footerText });
				return await interaction.editReply({ embeds: [emptyEmbed] });
			}

			const recentReports = reports.slice(0, limit);
			
			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} REPORT_DETAILS // ${city.toUpperCase()}`)
				.setDescription(`Showing the last ${recentReports.length} submitted report(s).`)
				.setColor(config.COLORS.primary)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			recentReports.forEach((r, index) => {
				const date = new Date(r.submittedDate).toLocaleDateString();
				const statusEmoji = r.status === 'on-time' ? '✅' : r.status === 'late' ? '⚠️' : '❌';
				const attachmentText = r.attachmentUrl ? `[View Attachment](${r.attachmentUrl})` : '*No attachment*';
				const notesText = r.notes ? r.notes.substring(0, 500) : '*No notes provided*';
				
				embed.addFields({
					name: `${statusEmoji} Report #${reports.length - index} (${r.type.toUpperCase()})`,
					value: `**Submitted**: ${date} (${r.status})\n**Attachment**: ${attachmentText}\n**Notes**: ${notesText}`,
					inline: false
				});
			});

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[REPORT_VIEW_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to view reports.`,
			});
		}
	},
};
