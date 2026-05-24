/**
 * 🪝 BITS&BYTES PROTOCOL - CAL.COM WEBHOOK SERVER
 * Version: 1.0.0
 * Purpose: Receives real-time Cal.com webhook events and syncs with Discord
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { EmbedBuilder } = require('discord.js');
const meetingsDb = require('./lib/meetingsDb');
const meetingsHelper = require('./lib/meetingsHelper');
const { getEventsChannel } = require('./lib/calcomWebhook');
const config = require('./config');
const logger = require('./lib/logger');

const PORT = parseInt(process.env.WEBHOOK_PORT || '3100', 10);
const SECRET = process.env.CALCOM_WEBHOOK_SECRET;

/**
 * Verify the Cal.com webhook signature using HMAC-SHA256
 * Cal.com sends the signature in the X-Cal-Signature-256 header
 * @param {string} rawBody - Raw request body string
 * @param {string} signature - Signature from X-Cal-Signature-256 header
 * @returns {boolean}
 */
function verifySignature(rawBody, signature) {
	if (!SECRET || !signature) return false;
	const expected = crypto
		.createHmac('sha256', SECRET)
		.update(rawBody)
		.digest('hex');
	return crypto.timingSafeEqual(
		Buffer.from(`sha256=${expected}`, 'utf8'),
		Buffer.from(signature, 'utf8')
	);
}

/**
 * Handle BOOKING_CREATED event
 */
async function handleBookingCreated(client, payload) {
	const guild = client.guilds.cache.first();
	if (!guild) {
		logger.warn('[WEBHOOK] Guild not available for BOOKING_CREATED.');
		return;
	}

	const uid = payload.uid;
	const title = payload.title || payload.eventTitle || 'Cal.com Meeting';
	const description = payload.description || payload.eventDescription || '';
	const startTime = Date.parse(payload.startTime);
	const endTime = Date.parse(payload.endTime);
	const location = payload.location || '';
	const isDiscordVC = !location || location.toLowerCase().includes('discord');

	// Check for existing meeting by Cal.com UID
	const existing = await meetingsDb.findMeetingByCalcomId(uid);
	if (existing) {
		logger.info(`[WEBHOOK] BOOKING_CREATED already imported: "${title}" (uid=${uid}). Skipping.`);
		return;
	}

	// Gather attendee emails
	const attendeeEmails = [];
	if (payload.organizer && payload.organizer.email) {
		attendeeEmails.push(payload.organizer.email.toLowerCase());
	}
	if (payload.attendees && Array.isArray(payload.attendees)) {
		for (const att of payload.attendees) {
			if (att.email) attendeeEmails.push(att.email.toLowerCase());
		}
	}
	// Also check responses.guests
	if (payload.responses && payload.responses.guests && payload.responses.guests.value) {
		const guests = payload.responses.guests.value;
		if (Array.isArray(guests)) {
			for (const g of guests) {
				if (typeof g === 'string' && g.includes('@')) attendeeEmails.push(g.toLowerCase());
			}
		}
	}

	// Match emails to registered Discord users
	const emailToUserMap = await meetingsDb.findUsersByEmails(attendeeEmails);
	const matchedDiscordIds = Object.values(emailToUserMap);
	const externalEmails = attendeeEmails.filter(email => !emailToUserMap[email]);

	// Check metadata for a linked Discord meeting
	let linkedMeetingId = null;
	if (payload.metadata && payload.metadata.discord_meeting_id) {
		linkedMeetingId = payload.metadata.discord_meeting_id;
	}

	if (linkedMeetingId) {
		// Update the existing Discord meeting with the Cal.com booking ID
		try {
			await meetingsDb.setCalcomBookingId(linkedMeetingId, uid);
			logger.info(`[WEBHOOK] Linked Cal.com booking ${uid} to Discord meeting ${linkedMeetingId}.`);
		} catch (err) {
			logger.warn(`[WEBHOOK] Failed to link booking ${uid} to meeting ${linkedMeetingId}:`, err);
		}
		return;
	}

	// Create a new meeting record
	const id = `meet_cal_${uid}`;
	const locationType = isDiscordVC ? 'discord_vc' : 'external';
	const locationDetails = isDiscordVC ? '' : location;

	const newMeeting = {
		id,
		title,
		description,
		scheduledTime: startTime,
		locationType,
		locationDetails,
		creatorId: client.user.id,
		status: 'scheduled',
		calcomBookingId: uid,
		calcomUid: uid,
		endTime,
		externalEmails
	};

	await meetingsDb.createMeeting(newMeeting);

	// Add Discord-matched attendees
	for (const discordId of matchedDiscordIds) {
		await meetingsDb.addAttendee(id, 'user', discordId);
	}

	// Fetch created meeting with attendees populated
	const createdMeeting = await meetingsDb.getMeeting(id);

	// Format time in IST
	const istTimeString = new Date(startTime).toLocaleString('en-US', {
		timeZone: 'Asia/Kolkata',
		hour12: true,
		hour: 'numeric',
		minute: '2-digit',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}) + ' IST';

	// Announce to events channel
	const eventsChannel = getEventsChannel(guild);
	if (eventsChannel) {
		const inviteesDisplay = matchedDiscordIds.map(uid => `<@${uid}>`).concat(externalEmails.map(e => `\`${e}\``));

		const embed = new EmbedBuilder()
			.setTitle(`📆 CALCOM_WEBHOOK // MEETING_CREATED`)
			.setDescription(`A new meeting was booked on Cal.com.`)
			.addFields(
				{ name: '📋 TITLE', value: title, inline: false },
				{ name: '📅 SCHEDULED TIME (IST)', value: `\`${istTimeString}\` (<t:${Math.floor(startTime / 1000)}:F>)`, inline: false },
				{ name: '🌐 LOCATION', value: locationType === 'discord_vc' ? 'Discord Temporary VC' : locationDetails, inline: true },
				{ name: '👥 INVITEES', value: inviteesDisplay.join(', ') || 'None', inline: true }
			)
			.setColor(config.COLORS.success)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		if (description) {
			embed.addFields({ name: '📝 DESCRIPTION', value: description, inline: false });
		}

		await eventsChannel.send({
			content: `🔔 **New Cal.com Booking**: ${matchedDiscordIds.map(uid => `<@${uid}>`).join(' ')}`,
			embeds: [embed]
		});
	}

	// Send email invitations
	if (createdMeeting) {
		await meetingsHelper.sendMeetingEmails(guild, createdMeeting, 'invite');
	}

	logger.info(`[WEBHOOK] BOOKING_CREATED processed: "${title}" (uid=${uid})`);
}

/**
 * Handle BOOKING_RESCHEDULED event
 */
async function handleBookingRescheduled(client, payload) {
	const guild = client.guilds.cache.first();
	if (!guild) {
		logger.warn('[WEBHOOK] Guild not available for BOOKING_RESCHEDULED.');
		return;
	}

	const uid = payload.uid;
	const title = payload.title || payload.eventTitle || 'Cal.com Meeting';
	const description = payload.description || payload.eventDescription || '';
	const startTime = Date.parse(payload.startTime);
	const endTime = Date.parse(payload.endTime);
	const location = payload.location || '';
	const isDiscordVC = !location || location.toLowerCase().includes('discord');
	const locationType = isDiscordVC ? 'discord_vc' : 'external';
	const locationDetails = isDiscordVC ? '' : location;

	// Check if meeting exists
	const existingMeeting = await meetingsDb.findMeetingByCalcomId(uid);
	
	// Gather attendee emails
	const attendeeEmails = [];
	if (payload.organizer && payload.organizer.email) {
		attendeeEmails.push(payload.organizer.email.toLowerCase());
	}
	if (payload.attendees && Array.isArray(payload.attendees)) {
		for (const att of payload.attendees) {
			if (att.email) attendeeEmails.push(att.email.toLowerCase());
		}
	}
	// Also check responses.guests
	if (payload.responses && payload.responses.guests && payload.responses.guests.value) {
		const guests = payload.responses.guests.value;
		if (Array.isArray(guests)) {
			for (const g of guests) {
				if (typeof g === 'string' && g.includes('@')) attendeeEmails.push(g.toLowerCase());
			}
		}
	}

	const uniqueAttendeeEmails = [...new Set(attendeeEmails)];
	const emailToUserMap = await meetingsDb.findUsersByEmails(uniqueAttendeeEmails);
	const matchedDiscordIds = Object.values(emailToUserMap);
	const externalEmails = uniqueAttendeeEmails.filter(email => !emailToUserMap[email]);

	if (existingMeeting) {
		const scheduledTimeChanged = Math.abs(existingMeeting.scheduled_time - startTime) > 60000;
		if (scheduledTimeChanged) {
			logger.info(`[WEBHOOK] Rescheduling meeting "${title}" to ${new Date(startTime).toISOString()}`);

			// Update times and status in DB
			const db = require('./lib/db');
			await db.run(
				`UPDATE meetings SET scheduled_time = ?, end_time = ?, status = 'scheduled' WHERE id = ?`,
				[startTime, endTime, existingMeeting.id]
			);

			// Clear sent reminders
			await db.run(`DELETE FROM meeting_reminders_sent WHERE meeting_id = ?`, [existingMeeting.id]);

			// Update attendees
			await db.run(`DELETE FROM meeting_attendees WHERE meeting_id = ?`, [existingMeeting.id]);
			for (const discordId of matchedDiscordIds) {
				await meetingsDb.addAttendee(existingMeeting.id, 'user', discordId);
			}

			// Refetch
			const updatedMeeting = await meetingsDb.getMeeting(existingMeeting.id);

			const newIstTimeString = new Date(startTime).toLocaleString('en-US', {
				timeZone: 'Asia/Kolkata',
				hour12: true,
				hour: 'numeric',
				minute: '2-digit',
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			}) + ' IST';

			// Announce to events channel
			const eventsChannel = getEventsChannel(guild);
			if (eventsChannel) {
				const inviteesDisplay = matchedDiscordIds.map(uid => `<@${uid}>`).concat(externalEmails.map(e => `\`${e}\``));
				const embed = new EmbedBuilder()
					.setTitle(`🔄 CALCOM_WEBHOOK // MEETING_RESCHEDULED`)
					.setDescription(`A meeting was rescheduled on Cal.com.`)
					.addFields(
						{ name: '📋 TITLE', value: title, inline: false },
						{ name: '📅 NEW SCHEDULED TIME (IST)', value: `\`${newIstTimeString}\` (<t:${Math.floor(startTime / 1000)}:F>)`, inline: false },
						{ name: '🌐 LOCATION', value: locationType === 'discord_vc' ? 'Discord Temporary VC' : locationDetails, inline: true },
						{ name: '👥 INVITEES', value: inviteesDisplay.join(', ') || 'None', inline: true }
					)
					.setColor(config.COLORS.warning)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				await eventsChannel.send({ embeds: [embed] });
			}

			// Send emails
			if (updatedMeeting) {
				await meetingsHelper.sendMeetingEmails(guild, updatedMeeting, 'invite');
			}
		}
	} else {
		// Import it as a new meeting
		await handleBookingCreated(client, payload);
	}
}

/**
 * Handle BOOKING_CANCELLED event
 */
async function handleBookingCancelled(client, payload) {
	const guild = client.guilds.cache.first();
	if (!guild) {
		logger.warn('[WEBHOOK] Guild not available for BOOKING_CANCELLED.');
		return;
	}

	const uid = payload.uid;
	const title = payload.title || payload.eventTitle || 'Cal.com Meeting';
	const cancellationReason = payload.cancellationReason || 'No reason provided';

	// Find existing meeting by Cal.com UID
	const existingMeeting = await meetingsDb.findMeetingByCalcomId(uid);
	if (!existingMeeting) {
		logger.info(`[WEBHOOK] BOOKING_CANCELLED: No matching Discord meeting for uid=${uid}. Skipping.`);
		return;
	}

	if (existingMeeting.status === 'completed' || existingMeeting.status === 'cancelled') {
		logger.info(`[WEBHOOK] BOOKING_CANCELLED: Meeting "${title}" already ${existingMeeting.status}. Skipping.`);
		return;
	}

	// Update meeting status
	await meetingsDb.updateMeetingStatus(existingMeeting.id, 'cancelled');

	// Delete temp VC if it exists
	if (existingMeeting.temp_channel_id) {
		const vc = guild.channels.cache.get(existingMeeting.temp_channel_id);
		if (vc) {
			await vc.delete('Meeting cancelled on Cal.com').catch(() => {});
		}
	}

	// Send cancellation emails
	await meetingsHelper.sendMeetingEmails(guild, existingMeeting, 'cancel');

	// Announce to events channel
	const eventsChannel = getEventsChannel(guild);
	if (eventsChannel) {
		const cancelEmbed = new EmbedBuilder()
			.setTitle(`❌ CALCOM_WEBHOOK // MEETING_CANCELLED`)
			.setDescription(`The meeting "**${existingMeeting.title}**" has been cancelled on Cal.com.`)
			.addFields(
				{ name: '📋 TITLE', value: existingMeeting.title, inline: false },
				{ name: '🚫 REASON', value: cancellationReason, inline: false }
			)
			.setColor(config.COLORS.error)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		await eventsChannel.send({ embeds: [cancelEmbed] });
	}

	logger.info(`[WEBHOOK] BOOKING_CANCELLED processed: "${title}" (uid=${uid})`);
}

/**
 * Process an incoming webhook payload
 */
async function processWebhook(client, body) {
	const triggerEvent = body.triggerEvent;
	const payload = body.payload;

	if (!triggerEvent || !payload) {
		logger.warn('[WEBHOOK] Received payload missing triggerEvent or payload field.');
		return;
	}

	switch (triggerEvent) {
		case 'BOOKING_CREATED':
			await handleBookingCreated(client, payload);
			break;
		case 'BOOKING_CANCELLED':
			await handleBookingCancelled(client, payload);
			break;
		case 'BOOKING_RESCHEDULED':
			await handleBookingRescheduled(client, payload);
			break;
		default:
			logger.info(`[WEBHOOK] Ignoring unhandled event: ${triggerEvent}`);
	}
}

/**
 * Start the webhook HTTP server
 * @param {Client} client - Discord client instance
 */
function startWebhookServer(client) {
	if (!SECRET) {
		logger.error('[WEBHOOK] CALCOM_WEBHOOK_SECRET is not set. Refusing to start webhook server.');
		return;
	}

	const server = http.createServer((req, res) => {
		// Only accept POST on /webhooks/calcom
		if (req.method !== 'POST' || req.url !== '/webhooks/calcom') {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Not Found');
			return;
		}

		// Collect raw body for signature verification
		const chunks = [];
		req.on('data', chunk => chunks.push(chunk));
		req.on('end', async () => {
			const rawBody = Buffer.concat(chunks).toString('utf8');
			const signature = req.headers['x-cal-signature-256'];

			// Verify signature
			if (!verifySignature(rawBody, signature)) {
				logger.warn('[WEBHOOK] Invalid or missing signature. Rejecting request.');
				res.writeHead(401, { 'Content-Type': 'text/plain' });
				res.end('Unauthorized');
				return;
			}

			// Parse JSON
			let body;
			try {
				body = JSON.parse(rawBody);
			} catch (parseErr) {
				logger.warn('[WEBHOOK] Failed to parse JSON body.', parseErr);
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Bad Request');
				return;
			}

			// Acknowledge immediately (Cal.com expects fast response)
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('OK');

			// Process asynchronously
			try {
				await processWebhook(client, body);
			} catch (err) {
				logger.error('[WEBHOOK] Error processing webhook event', err);
			}
		});

		req.on('error', (err) => {
			logger.error('[WEBHOOK] Request error', err);
		});
	});

	server.listen(PORT, '127.0.0.1', () => {
		console.log(`[BOOT] Webhook server listening on port ${PORT}`);
		logger.boot(`Webhook server listening on port ${PORT}`, null, false);
	});

	server.on('error', (err) => {
		logger.error(`[WEBHOOK] Server error on port ${PORT}`, err);
	});
}

module.exports = { startWebhookServer };
