const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const events = require('../lib/events');
const gamification = require('../lib/gamification');
const config = require('../config');
const auth = require('../lib/auth');
const calcom = require('../lib/calcom');
const db = require('../lib/db');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('event-update')
		.setDescription('Update an existing event')
		.addStringOption(option =>
			option
				.setName('event-id')
				.setDescription('Event ID to update')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('status')
				.setDescription('New event status')
				.setRequired(false)
				.addChoices(
					{ name: '💡 Idea', value: 'Idea' },
					{ name: '📋 Planned', value: 'Planned' },
					{ name: '✅ Approved', value: 'Approved' },
					{ name: '🚀 Executing', value: 'Executing' },
					{ name: '🎉 Completed', value: 'Completed' },
					{ name: '❌ Cancelled', value: 'Cancelled' },
				))
		.addStringOption(option =>
			option
				.setName('date')
				.setDescription('New event date (YYYY-MM-DD)')
				.setRequired(false))
		.addIntegerOption(option =>
			option
				.setName('attendees')
				.setDescription('Actual attendees count')
				.setRequired(false)
				.setMinValue(0)),

	async execute(interaction) {
		const flags = config.PRIVACY['event-update'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const eventId = interaction.options.getString('event-id');
			const status = interaction.options.getString('status');
			const date = interaction.options.getString('date');
			const attendees = interaction.options.getInteger('attendees');

			// Get the event directly by ID (efficient single-row lookup)
			const row = await db.get('SELECT * FROM events WHERE id = ?', [eventId]);
			const event = row ? {
				id: row.id,
				forkId: row.fork_id,
				title: row.title,
				date: row.date,
				type: row.type,
				status: row.status,
				calcomBookingId: row.calcom_booking_id || null,
			} : null;
			if (!event) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Event not found for ID: ${eventId}`,
				});
			}

			// Enforce authorization check using the event's forkId
			const isAuthorized = await auth.isAuthorizedForForkId(interaction.user, event.forkId, interaction.guild);
			if (!isAuthorized) {
				const unauthorizedEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
					.setDescription('Your credentials do not grant access to update events for this city node.')
					.setColor(config.COLORS.error)
					.setFooter({ text: config.BRANDING.footerText });
				return await interaction.editReply({ embeds: [unauthorizedEmbed] });
			}

			// Validate at least one update provided
			if (!status && !date && attendees === null) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Please provide at least one field to update.`,
				});
			}

			// Validate date format if provided
			if (date) {
				const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
				if (!dateRegex.test(date)) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} Invalid date format. Please use YYYY-MM-DD.`,
					});
				}
			}

			// Update the event
			const update = {};
			if (status) update.status = status;
			if (date) update.date = date;
			if (attendees !== null) update.attendees = attendees;

			await notion.updateEvent(eventId, update);

			// Sync Cal.com: cancel booking if event is cancelled
			if (status === 'Cancelled' && event.calcomBookingId && process.env.CALCOM_API_KEY) {
				try {
					await calcom.cancelBooking(
						event.calcomBookingId,
						`Event cancelled via Discord by ${interaction.user.username}`
					);
					console.log(`[EVENT_UPDATE] Cal.com booking ${event.calcomBookingId} cancelled`);
				} catch (calErr) {
					console.warn('[EVENT_UPDATE] Cal.com cancel failed (non-fatal):', calErr.message);
				}
			}

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} EVENT_UPDATED`)
				.setColor(config.COLORS.success)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			let updateText = '';
			if (status) {
				const stageEmoji = events.getStageEmoji(status);
				updateText += `${stageEmoji} **Status**: ${status}\n`;
			}
			if (date) {
				updateText += `📅 **Date**: ${date}\n`;
			}
			if (attendees !== null) {
				updateText += `👥 **Attendees**: ${attendees}\n`;
			}

			embed.addFields({
				name: '✅ CHANGES_APPLIED',
				value: updateText,
				inline: false,
			});

			embed.addFields({
				name: '📌 EVENT_ID',
				value: eventId,
				inline: false,
			});

			// Points for completing event - actually award the points
			if (status === 'Completed') {
				try {
					if (event && event.forkId) {
						await notion.updateForkPoints(event.forkId, gamification.POINTS.EVENT_COMPLETED);
						embed.addFields({
							name: '🎉 EVENT_COMPLETED',
							value: `+${gamification.POINTS.EVENT_COMPLETED} points awarded for hosting an event!`,
							inline: false,
						});
					} else {
						embed.addFields({
							name: '🎉 EVENT_COMPLETED',
							value: 'Event marked as complete. Points will be awarded by the monthly review.',
							inline: false,
						});
					}
				} catch (e) {
					console.error('[EVENT_UPDATE] Failed to award points:', e.message);
					embed.addFields({
						name: '⚠️ EVENT_COMPLETED',
						value: 'Event marked as complete, but points could not be awarded automatically.',
						inline: false,
					});
				}
			}

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[EVENT_UPDATE_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to update event.`,
			});
		}
	},
};