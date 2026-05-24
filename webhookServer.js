/**
 * 🛰️ BITS&BYTES PROTOCOL - WEBHOOK SERVER ENGINE
 * Version: 1.0.0
 * Purpose: Receives and processes real-time Cal.com webhooks with zero external dependencies
 */

const http = require('http');
const crypto = require('crypto');
const logger = require('./lib/logger');
const meetingsDb = require('./lib/meetingsDb');
const meetingsHelper = require('./lib/meetingsHelper');
const { getEventsChannel } = require('./lib/calcomWebhook');
const { EmbedBuilder } = require('discord.js');
const config = require('./config');

function verifySignature(payload, signature, secret) {
	if (!secret) return true;
	const computed = crypto
		.createHmac('sha256', secret)
		.update(payload)
		.digest('hex');
	return computed === signature;
}

/**
 * Starts the native HTTP server to listen for Cal.com webhook payloads
 * @param {Client} client - The Discord client instance
 */
function startWebhookServer(client) {
	const port = parseInt(process.env.WEBHOOK_PORT || '3100', 10);
	const secret = process.env.CALCOM_WEBHOOK_SECRET;

	const server = http.createServer((req, res) => {
		if (req.method === 'POST' && req.url === '/webhooks/calcom') {
			let body = '';
			req.on('data', chunk => {
				body += chunk;
			});
			req.on('end', async () => {
				const signature = req.headers['x-cal-signature-256'];
				if (secret && !verifySignature(body, signature, secret)) {
					logger.warn('[WEBHOOK] Invalid webhook signature received.');
					res.writeHead(401, { 'Content-Type': 'application/json' });
					return res.end(JSON.stringify({ error: 'Unauthorized' }));
				}

				try {
					const payload = JSON.parse(body);
					const triggerEvent = payload.triggerEvent;
					const booking = payload.payload;

					if (!booking) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						return res.end(JSON.stringify({ error: 'Missing payload data' }));
					}

					logger.info(`[WEBHOOK] Received ${triggerEvent} event for booking ${booking.uid}`);
					
					const guild = client.guilds.cache.first();
					if (!guild) {
						res.writeHead(500, { 'Content-Type': 'application/json' });
						return res.end(JSON.stringify({ error: 'Guild not ready' }));
					}

					const calcomId = String(booking.uid || booking.id);
					let existingMeeting = await meetingsDb.findMeetingByCalcomId(calcomId);

					if (triggerEvent === 'BOOKING_CANCELLED') {
						if (existingMeeting && existingMeeting.status !== 'completed') {
							await meetingsDb.updateMeetingStatus(existingMeeting.id, 'completed');
							
							if (existingMeeting.temp_channel_id) {
								const vc = guild.channels.cache.get(existingMeeting.temp_channel_id);
								if (vc) {
									await vc.delete('Meeting cancelled on Cal.com').catch(() => {});
								}
							}

							await meetingsHelper.sendMeetingEmails(guild, existingMeeting, 'cancel');

							const eventsChannel = getEventsChannel(guild);
							if (eventsChannel) {
								const cancelEmbed = new EmbedBuilder()
									.setTitle(`❌ MEETING_CANCELLED // WEBHOOK`)
									.setDescription(`The meeting "**${existingMeeting.title}**" has been cancelled on Cal.com.`)
									.setColor(config.COLORS.error)
									.setTimestamp()
									.setFooter({ text: config.BRANDING.footerText });
								await eventsChannel.send({ embeds: [cancelEmbed] });
							}
						}
					} else if (triggerEvent === 'BOOKING_CREATED') {
						if (!existingMeeting) {
							const id = `meet_cal_${calcomId}`;
							const startTime = Date.parse(booking.startTime || booking.start);
							const endTime = Date.parse(booking.endTime || booking.end);
							const location = booking.meetingUrl || booking.location || 'Discord VC';
							const isDiscordVC = !booking.meetingUrl && (!booking.location || booking.location.toLowerCase().includes('discord'));
							const locationType = isDiscordVC ? 'discord_vc' : 'external';
							const locationDetails = isDiscordVC ? '' : location;

							const attendeeEmails = [];
							if (booking.attendee && booking.attendee.email) {
								attendeeEmails.push(booking.attendee.email.toLowerCase());
							}
							if (booking.attendees && Array.isArray(booking.attendees)) {
								for (const att of booking.attendees) {
									if (att.email) attendeeEmails.push(att.email.toLowerCase());
								}
							}

							const emailToUserMap = await meetingsDb.findUsersByEmails(attendeeEmails);
							const matchedDiscordIds = Object.values(emailToUserMap);
							const externalEmails = attendeeEmails.filter(email => !emailToUserMap[email]);

							const newMeeting = {
								id,
								title: booking.title || 'Cal.com Webhook Booking',
								description: booking.description || '',
								scheduledTime: startTime,
								locationType,
								locationDetails,
								creatorId: client.user.id,
								status: 'scheduled',
								calcomBookingId: calcomId,
								calcomUid: booking.uid || null,
								endTime,
								externalEmails
							};

							await meetingsDb.createMeeting(newMeeting);

							for (const discordId of matchedDiscordIds) {
								await meetingsDb.addAttendee(id, 'user', discordId);
							}

							const createdMeeting = await meetingsDb.getMeeting(id);
							
							const istTimeString = new Date(startTime).toLocaleString('en-US', {
								timeZone: 'Asia/Kolkata',
								hour12: true,
								hour: 'numeric',
								minute: '2-digit',
								day: 'numeric',
								month: 'short',
								year: 'numeric'
							}) + ' IST';

							const eventsChannel = getEventsChannel(guild);
							if (eventsChannel) {
								const inviteesDisplay = matchedDiscordIds.map(uid => `<@${uid}>`).concat(externalEmails.map(e => `\`${e}\``));
								const embed = new EmbedBuilder()
									.setTitle(`📆 WEBHOOK // MEETING_IMPORTED`)
									.setDescription(`A meeting was booked via Cal.com.`)
									.addFields(
										{ name: '📋 TITLE', value: booking.title, inline: false },
										{ name: '📅 SCHEDULED TIME (IST)', value: `\`${istTimeString}\` (<t:${Math.floor(startTime / 1000)}:F>)`, inline: false },
										{ name: '🌐 LOCATION', value: locationType === 'discord_vc' ? 'Discord Temporary VC' : locationDetails, inline: true },
										{ name: '👥 INVITEES', value: inviteesDisplay.join(', ') || 'None', inline: true }
									)
									.setColor(config.COLORS.primary)
									.setTimestamp()
									.setFooter({ text: config.BRANDING.footerText });
								await eventsChannel.send({ embeds: [embed] });
							}

							await meetingsHelper.sendMeetingEmails(guild, createdMeeting, 'invite');
						}
					}

					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ status: 'success' }));
				} catch (err) {
					logger.error('[WEBHOOK] Error processing webhook data', err);
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Internal Server Error' }));
				}
			});
		} else {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Not Found');
		}
	});

	server.listen(port, () => {
		logger.boot(`Webhook server listening on port ${port}`, null, false);
	});

	return server;
}

module.exports = {
	startWebhookServer
};
