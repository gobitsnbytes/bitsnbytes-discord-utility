const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const gamification = require('../lib/gamification');
const config = require('../config');
const auth = require('../lib/auth');

// Shared execution logic to process report submission
async function processReportSubmission(user, city, type, notes, attachmentUrl, guild) {
	// Enforce authorization check
	const isAuthorized = await auth.isAuthorizedForCity(user, city, guild, 'modify');
	if (!isAuthorized) {
		return {
			success: false,
			embed: new EmbedBuilder()
				.setTitle('Access Denied')
				.setDescription(`You do not have permission to submit reports for ${city}.`)
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText })
		};
	}

	// Find the fork
	const fork = await notion.findForkByCity(city);
	if (!fork) {
		return {
			success: false,
			error: `Fork not found: ${city}`
		};
	}

	// Prevent duplicate reports within the same period
	try {
		const reports = await notion.getReports(fork.id).catch(() => []);
		const now = new Date();
		const currentMonth = now.getMonth();
		const currentYear = now.getFullYear();
		const currentDay = now.getDate();

		if (type === 'monthly') {
			const hasMonthly = reports.some(r => {
				if (r.type !== 'monthly') return false;
				const submitted = new Date(r.submittedDate);
				return submitted.getMonth() === currentMonth && submitted.getFullYear() === currentYear;
			});
			if (hasMonthly) {
				return {
					success: false,
					error: `A monthly report for ${city} has already been submitted this month.`
				};
			}
		} else if (type === 'bi-weekly') {
			const isFirstHalf = currentDay <= 15;
			const hasBiweekly = reports.some(r => {
				if (r.type !== 'bi-weekly') return false;
				const submitted = new Date(r.submittedDate);
				if (submitted.getMonth() !== currentMonth || submitted.getFullYear() !== currentYear) return false;
				const day = submitted.getDate();
				return isFirstHalf ? (day >= 1 && day <= 15) : (day >= 16);
			});
			if (hasBiweekly) {
				return {
					success: false,
					error: `A bi-weekly report (for the ${isFirstHalf ? 'first' : 'second'} half of this month) has already been submitted for ${city}.`
				};
			}
		}
	} catch (err) {
		console.warn(`[REPORT_SUBMIT] Failed to perform duplicate report check:`, err.message);
	}

	// Create the report in Notion
	await notion.createReport({
		forkId: fork.id,
		type: type,
		city: city,
		notes: notes,
		attachmentUrl: attachmentUrl,
		isLate: false, // Will be determined by background checks
	});

	// Increment reports count
	await notion.incrementForkReports(fork.id);

	// Award points for report submission
	try {
		await notion.updateForkPoints(fork.id, gamification.POINTS.REPORT_SUBMISSION);
	} catch (e) {
		// Ignore points update errors
	}

	const embed = new EmbedBuilder()
		.setTitle(`Report Submitted: ${city}`)
		.setColor(config.COLORS.success)
		.setTimestamp()
		.setFooter({ text: config.BRANDING.footerText })
		.addFields({
			name: 'Submission Confirmed',
			value: `Type: ${type.charAt(0).toUpperCase() + type.slice(1)} Report\nSubmitted: <t:${Math.floor(Date.now() / 1000)}:R>`,
			inline: false,
		});

	if (notes) {
		embed.addFields({
			name: 'Notes',
			value: notes.substring(0, 1000),
			inline: false,
		});
	}

	if (attachmentUrl) {
		embed.addFields({
			name: 'Attachment',
			value: `[View Attachment](${attachmentUrl})`,
			inline: false,
		});
	}

	embed.addFields({
		name: 'Points Awarded',
		value: `${gamification.POINTS.REPORT_SUBMISSION} points added to the fork.`,
		inline: false,
	});

	return {
		success: true,
		embed
	};
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('report-submit')
		.setDescription('Submit a fork report')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(false))
		.addStringOption(option =>
			option
				.setName('type')
				.setDescription('Report type')
				.setRequired(false)
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
				.setRequired(false))
		.addAttachmentOption(option =>
			option
				.setName('file')
				.setDescription('Direct PDF/file upload')
				.setRequired(false)),

	async execute(interaction) {
		const flags = config.PRIVACY['report-submit'] ? [MessageFlags.Ephemeral] : [];
		
		const city = interaction.options.getString('city');
		const type = interaction.options.getString('type');
		const notes = interaction.options.getString('notes') || '';
		const file = interaction.options.getAttachment('file');
		let attachmentUrl = interaction.options.getString('attachment') || null;
		if (file) {
			attachmentUrl = file.url;
		}

		// If arguments are missing, present the interactive form button
		if (!city || !type) {
			await interaction.deferReply({ flags });

			const embed = new EmbedBuilder()
				.setTitle('Submit Fork Report')
				.setDescription('Fill out the details of your fork report using the button below.')
				.setColor(config.COLORS.primary)
				.setFooter({ text: config.BRANDING.footerText });

			const btn = new ButtonBuilder()
				.setCustomId('trigger_report_modal')
				.setLabel('Open Submission Form')
				.setStyle(ButtonStyle.Primary);

			const row = new ActionRowBuilder().addComponents(btn);

			const response = await interaction.editReply({
				embeds: [embed],
				components: [row]
			});

			const filter = (i) => i.customId === 'trigger_report_modal' && i.user.id === interaction.user.id;
			const collector = response.createMessageComponentCollector({ filter, time: 60000 });

			collector.on('collect', async (btnInteraction) => {
				const modal = new ModalBuilder()
					.setCustomId('submit_report_modal')
					.setTitle('Submit Fork Report');

				const cityInput = new TextInputBuilder()
					.setCustomId('modal_city')
					.setLabel('Fork City')
					.setPlaceholder('e.g. Delhi, Prayagraj')
					.setStyle(TextInputStyle.Short)
					.setRequired(true);

				const typeInput = new TextInputBuilder()
					.setCustomId('modal_type')
					.setLabel('Report Type (monthly / bi-weekly)')
					.setPlaceholder('monthly or bi-weekly')
					.setStyle(TextInputStyle.Short)
					.setRequired(true);

				const notesInput = new TextInputBuilder()
					.setCustomId('modal_notes')
					.setLabel('Additional Notes')
					.setPlaceholder('Enter report notes or details...')
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(false);

				const attachmentInput = new TextInputBuilder()
					.setCustomId('modal_attachment')
					.setLabel('Attachment URL (PDF, doc link)')
					.setPlaceholder('https://...')
					.setStyle(TextInputStyle.Short)
					.setRequired(false);

				modal.addComponents(
					new ActionRowBuilder().addComponents(cityInput),
					new ActionRowBuilder().addComponents(typeInput),
					new ActionRowBuilder().addComponents(notesInput),
					new ActionRowBuilder().addComponents(attachmentInput)
				);

				await btnInteraction.showModal(modal);

				try {
					const modalSubmit = await btnInteraction.awaitModalSubmit({
						filter: (m) => m.customId === 'submit_report_modal' && m.user.id === interaction.user.id,
						time: 240000
					});

					await modalSubmit.deferReply({ flags: MessageFlags.Ephemeral });

					const modalCity = modalSubmit.fields.getTextInputValue('modal_city').trim();
					const modalType = modalSubmit.fields.getTextInputValue('modal_type').trim().toLowerCase();
					const modalNotes = modalSubmit.fields.getTextInputValue('modal_notes').trim();
					const modalAttachment = modalSubmit.fields.getTextInputValue('modal_attachment').trim() || null;

					if (modalType !== 'monthly' && modalType !== 'bi-weekly') {
						return await modalSubmit.editReply({
							content: 'Invalid report type. Please enter either "monthly" or "bi-weekly".'
						});
					}

					const result = await processReportSubmission(interaction.user, modalCity, modalType, modalNotes, modalAttachment, interaction.guild);
					
					if (result.success) {
						await modalSubmit.editReply({ embeds: [result.embed] });
						
						// Disable the trigger button
						btn.setDisabled(true).setLabel('Form Submitted');
						await interaction.editReply({ components: [new ActionRowBuilder().addComponents(btn)] });
					} else {
						if (result.embed) {
							await modalSubmit.editReply({ embeds: [result.embed] });
						} else {
							await modalSubmit.editReply({ content: result.error || 'Failed to submit report.' });
						}
					}

				} catch (modalErr) {
					console.warn('[REPORT_MODAL_COLLECTOR] Modal timed out or failed:', modalErr.message);
				}
			});

			return;
		}

		// Direct parameter execution
		await interaction.deferReply({ flags });

		try {
			const result = await processReportSubmission(interaction.user, city, type, notes, attachmentUrl, interaction.guild);
			if (result.success) {
				await interaction.editReply({ embeds: [result.embed] });
			} else {
				if (result.embed) {
					await interaction.editReply({ embeds: [result.embed] });
				} else {
					await interaction.editReply({ content: result.error || 'Failed to submit report.' });
				}
			}
		} catch (error) {
			console.error('[REPORT_SUBMIT_ERROR]', error);
			await interaction.editReply({
				content: 'Something went wrong while submitting the report.',
			});
		}
	},
};