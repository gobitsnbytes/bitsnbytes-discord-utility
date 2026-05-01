const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('report-submit')
		.setDescription('Submit a fork report')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('type')
				.setDescription('Report type')
				.setRequired(true)
				.addChoices(
					{ name: 'Monthly', value: 'monthly' },
					{ name: 'Bi-weekly', value: 'bi-weekly' },
				))
		.addStringOption(option =>
			option
				.setName('notes')
				.setDescription('Additional notes')
				.setRequired(false))
		.addStringOption(option =>
			option
				.setName('attachment')
				.setDescription('Attachment URL (PDF, etc.)')
				.setRequired(false)),

	async execute(interaction) {
		const flags = config.PRIVACY['report-submit'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const city = interaction.options.getString('city');
			const type = interaction.options.getString('type');
			const notes = interaction.options.getString('notes') || '';
			const attachmentUrl = interaction.options.getString('attachment') || null;

			// Find the fork
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Fork not found: ${city}`,
				});
			}

			// Create the report
			await notion.createReport({
				forkId: fork.id,
				type: type,
				city: city,
				notes: notes,
				attachmentUrl: attachmentUrl,
				isLate: false, // Will be determined by job
			});

			// Increment reports count
			await notion.incrementForkReports(fork.id);

			// Award points for on-time report
			try {
				await notion.updateForkPoints(fork.id, 5);
			} catch (e) {
				// Points might not be set up, ignore
			}

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} REPORT_SUBMITTED // ${city.toUpperCase()}`)
				.setColor(config.COLORS.success)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			embed.addFields({
				name: '✅ SUBMISSION_CONFIRMED',
				value: `**Type**: ${type.charAt(0).toUpperCase() + type.slice(1)} Report\n**Submitted**: <t:${Math.floor(Date.now() / 1000)}:R>`,
				inline: false,
			});

			if (notes) {
				embed.addFields({
					name: '📝 NOTES',
					value: notes.substring(0, 1000),
					inline: false,
				});
			}

			if (attachmentUrl) {
				embed.addFields({
					name: '📎 ATTACHMENT',
					value: `[View Attachment](${attachmentUrl})`,
					inline: false,
				});
			}

			embed.addFields({
				name: '🏆 POINTS',
				value: '+5 points awarded for report submission!',
				inline: false,
			});

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[REPORT_SUBMIT_ERROR]', error);
			
			if (error.message.includes('NOTION_REPORTS_DB not configured')) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Reports database not configured. Please set NOTION_REPORTS_DB in environment.`,
				});
			}

			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to submit report.`,
			});
		}
	},
};