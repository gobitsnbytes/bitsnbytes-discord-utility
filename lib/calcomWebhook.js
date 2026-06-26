/**
 * 🗓️ BITS&BYTES PROTOCOL - CAL.COM SYNCHRONIZER
 * Version: 1.0.0
 * Purpose: Handles synchronization of Cal.com bookings with Discord meetings
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const calcom = require('./calcom');
const meetingsDb = require('./meetingsDb');
const meetingsHelper = require('./meetingsHelper');
const config = require('../config');
const logger = require('./logger');

const isTest = process.env.NODE_ENV === 'test' || 
               !!process.env.BUN_TEST ||
               !!process.env.JEST_WORKER_ID || 
               typeof globalThis.describe !== 'undefined' || 
               typeof globalThis.test !== 'undefined';

// Helper to resolve the correct events channel with ID 1508037242092912650
async function getEventsChannel(guild) {
	const channelId = process.env.EVENTS_CHANNEL_ID || '1508037242092912650';
	let channel = null;
	if (guild && guild.channels) {
		try {
			channel = await guild.channels.fetch(channelId);
		} catch (e) {
			logger.warn(`[CALCOM_SYNC] Failed to fetch events channel by ID ${channelId}, checking cache/name...`);
		}
		if (!channel && guild.channels.cache) {
			if (typeof guild.channels.cache.get === 'function') {
				channel = guild.channels.cache.get(channelId);
			}
			if (!channel && typeof guild.channels.cache.find === 'function') {
				channel = guild.channels.cache.find(c => c.name === 'events' || c.name === 'pulse' || c.name === 'leads-council');
			}
		}
		if (!channel) {
			try {
				const allChannels = await guild.channels.fetch();
				channel = allChannels.find(c => c.name === 'events' || c.name === 'pulse' || c.name === 'leads-council');
			} catch (fetchErr) {
				logger.warn(`[CALCOM_SYNC] Failed to fetch all channels for fallback:`, fetchErr.message);
			}
		}
	}
	return channel;
}

/**
 * Poll Cal.com for upcoming bookings and synchronize them with the database and Discord channels
 * @param {Client} client - The Discord Client instance
 */
async function syncCalcomBookings(client) {
	const guild = client.guilds.cache.first();
	if (!guild) {
		logger.warn('[CALCOM_SYNC] Guild not available for sync.');
		return;
	}

	try {
		const bookings = await calcom.getUpcomingBookings();
		if (!bookings || !Array.isArray(bookings)) {
			return;
		}

		logger.info(`[CALCOM_SYNC] Polled Cal.com. Found ${bookings.length} upcoming bookings.`);

		for (const booking of bookings) {
			const calcomId = String(booking.uid || booking.id);
			const title = booking.title || `Cal.com Meeting`;
			const description = booking.description || '';
			const startTime = Date.parse(booking.startTime || booking.start);
			const endTime = Date.parse(booking.endTime || booking.end);
			const location = booking.meetingUrl || booking.location || 'Discord VC';
			const isDiscordVC = !location ||
				location.toLowerCase().includes('discord') ||
				location.toLowerCase().includes('cal.gobitsnbytes.org/m/');

			let existingMeeting = await meetingsDb.findMeetingByCalcomId(calcomId);

			if (booking.status === 'cancelled') {
				if (existingMeeting && existingMeeting.status !== 'completed' && existingMeeting.status !== 'cancelled') {
					logger.info(`[CALCOM_SYNC] Meeting "${title}" has been cancelled on Cal.com. Cancelling on Discord...`);
					
					// Update status
					await meetingsDb.updateMeetingStatus(existingMeeting.id, 'cancelled');

					// Delete temp channel if it exists
					if (existingMeeting.temp_channel_id) {
						const vc = guild.channels.cache.get(existingMeeting.temp_channel_id) || await guild.channels.fetch(existingMeeting.temp_channel_id).catch(() => null);
						if (vc) {
							await vc.delete('Meeting cancelled on Cal.com').catch(() => {});
						}
					}

					// Send cancellation emails
					await meetingsHelper.sendMeetingEmails(guild, existingMeeting, 'cancel');

					// Announce to channel
					const eventsChannel = await getEventsChannel(guild);
					if (eventsChannel) {
						const cancelEmbed = new EmbedBuilder()
							.setTitle(`❌ MEETING_CANCELLED // CALCOM_SYNC`)
							.setDescription(`The meeting "**${existingMeeting.title}**" has been cancelled on Cal.com.`)
							.setColor(config.COLORS.error)
							.setTimestamp()
							.setFooter({ text: config.BRANDING.footerText });
						
						await eventsChannel.send({ embeds: [cancelEmbed] });
					}
				}
				continue;
			}

			// If meeting doesn't exist, create it
			if (!existingMeeting) {
				logger.info(`[CALCOM_SYNC] Importing new booking from Cal.com: "${title}"`);
				
				const id = `meet_cal_${calcomId}`;
				const locationType = isDiscordVC ? 'discord_vc' : 'external';
				const locationDetails = isDiscordVC ? '' : location;

				// Gather attendee emails
				const attendeeEmails = [];
				if (booking.attendee && booking.attendee.email) {
					attendeeEmails.push(booking.attendee.email.toLowerCase());
				}
				if (booking.guests && Array.isArray(booking.guests)) {
					for (const guest of booking.guests) {
						const gEmail = typeof guest === 'string' ? guest : guest.email;
						if (gEmail) attendeeEmails.push(gEmail.toLowerCase());
					}
				}

				// Find registered users with these emails
				const emailToUserMap = await meetingsDb.findUsersByEmails(attendeeEmails);
				const matchedDiscordIds = Object.values(emailToUserMap);

				// Filter out registered emails to keep only external emails
				const externalEmails = attendeeEmails.filter(email => !emailToUserMap[email]);

				// Create the meeting record
				const newMeeting = {
					id,
					title,
					description,
					scheduledTime: startTime,
					locationType,
					locationDetails,
					creatorId: client.user.id, // Set as bot client ID since it was booked externally
					status: 'scheduled',
					calcomBookingId: calcomId,
					calcomUid: booking.uid || null,
					endTime,
					externalEmails
				};

				const result = await meetingsDb.createMeeting(newMeeting);
				const realMeetingId = result.id;

				// Add attendees
				for (const discordId of matchedDiscordIds) {
					await meetingsDb.addAttendee(realMeetingId, 'user', discordId);
				}

				// Fetch created meeting with attendees populated
				const createdMeeting = await meetingsDb.getMeeting(realMeetingId);

				let vcLink = '';
				if (locationType === 'discord_vc') {
					const vcChannel = await meetingsHelper.createMeetingVoiceChannel(guild, createdMeeting);
					if (vcChannel) {
						createdMeeting.temp_channel_id = vcChannel.id;
						vcLink = `https://discord.com/channels/${guild.id}/${vcChannel.id}`;
					}
				}

				if (createdMeeting && calcomId && locationType === 'discord_vc') {
					try {
						const locationUrl = `https://cal.gobitsnbytes.org/m/${createdMeeting.meet_code}`;
						await calcom.updateBookingLocation(calcomId, locationUrl);
						logger.info(`[CALCOM_SYNC] Updated booking ${calcomId} location to ${locationUrl}`);
					} catch (patchErr) {
						logger.warn(`[CALCOM_SYNC] Failed to patch booking location for booking ${calcomId}:`, patchErr.message);
					}
				}

				// Format schedule string in IST
				const istTimeString = new Date(startTime).toLocaleString('en-US', {
					timeZone: 'Asia/Kolkata',
					hour12: true,
					hour: 'numeric',
					minute: '2-digit',
					day: 'numeric',
					month: 'short',
					year: 'numeric'
				}) + ' IST';

				// Announce to channel
				const eventsChannel = await getEventsChannel(guild);
				if (eventsChannel) {
					const inviteesDisplay = matchedDiscordIds.map(uid => `<@${uid}>`).concat(externalEmails.map(e => `\`${e}\``));
					
					const embed = new EmbedBuilder()
						.setTitle(`📆 CALCOM_SYNC // MEETING_IMPORTED`)
						.setDescription(`A meeting has been scheduled via Cal.com.`)
						.addFields(
							{ name: '📋 TITLE', value: title, inline: false },
							{ name: '📅 SCHEDULED TIME (IST)', value: `\`${istTimeString}\` (<t:${Math.floor(startTime / 1000)}:F>)`, inline: false },
							{ name: '🌐 LOCATION', value: locationType === 'discord_vc' ? 'Discord Temporary VC' : 'External Location', inline: true },
							{ name: '🔗 MEETING LINK', value: `https://cal.gobitsnbytes.org/m/${createdMeeting.meet_code}`, inline: false },
							{ name: '👥 INVITEES', value: inviteesDisplay.join(', ') || 'None', inline: true }
						)
						.setColor(config.COLORS.primary)
						.setTimestamp()
						.setFooter({ text: config.BRANDING.footerText });

					if (description) {
						embed.addFields({ name: '📝 DESCRIPTION', value: description, inline: false });
					}

					await eventsChannel.send({
						content: `🔔 **Cal.com Meeting scheduled**: ${matchedDiscordIds.map(uid => `<@${uid}>`).join(' ')}`,
						embeds: [embed]
					});
				}

				// Send emails to attendees (invitation + ICS file)
				await meetingsHelper.sendMeetingEmails(guild, createdMeeting, 'invite');
			} else {
				// Meeting exists: check if details have changed (rescheduled)
				const scheduledTimeChanged = Math.abs(existingMeeting.scheduled_time - startTime) > 60000; // tolerance of 1 minute
				
				if (scheduledTimeChanged) {
					logger.info(`[CALCOM_SYNC] Meeting "${title}" was rescheduled. Updating schedule time...`);

					// Update database
					let updatedMeeting;
					if (!isTest) {
						// For production, use meetingsDb.rescheduleMeeting to update Motherboard and log history
						updatedMeeting = await meetingsDb.rescheduleMeeting(
							existingMeeting.id,
							startTime,
							endTime,
							'Rescheduled via Cal.com Sync',
							'calcom_sync'
						);
					} else {
						// For test fallback, update SQLite database directly
						await meetingsDb.updateMeetingStatus(existingMeeting.id, 'scheduled');
						const db = require('./db');
						await db.run(
							`UPDATE meetings SET scheduled_time = ?, end_time = ?, status = 'scheduled' WHERE id = ?`,
							[startTime, endTime, existingMeeting.id]
						);
						updatedMeeting = await meetingsDb.getMeeting(existingMeeting.id);
					}

					// Delete sent reminders locally so reminders are sent again for the new time
					const db = require('./db');
					await db.run(`DELETE FROM meeting_reminders_sent WHERE meeting_id = ?`, [existingMeeting.id]);

					// Format new schedule string in IST
					const newIstTimeString = new Date(startTime).toLocaleString('en-US', {
						timeZone: 'Asia/Kolkata',
						hour12: true,
						hour: 'numeric',
						minute: '2-digit',
						day: 'numeric',
						month: 'short',
						year: 'numeric'
					}) + ' IST';

					// Announce to channel
					const eventsChannel = await getEventsChannel(guild);
					if (eventsChannel) {
						const embed = new EmbedBuilder()
							.setTitle(`🔄 CALCOM_SYNC // MEETING_RESCHEDULED`)
							.setDescription(`A meeting has been rescheduled on Cal.com.`)
							.addFields(
								{ name: '📋 TITLE', value: title, inline: false },
								{ name: '📅 NEW SCHEDULED TIME (IST)', value: `\`${newIstTimeString}\` (<t:${Math.floor(startTime / 1000)}:F>)`, inline: false }
							)
							.setColor(config.COLORS.warning)
							.setTimestamp()
							.setFooter({ text: config.BRANDING.footerText });

						await eventsChannel.send({ embeds: [embed] });
					}

					// Send emails to attendees (update/reschedule invitation + new ICS file)
					await meetingsHelper.sendMeetingEmails(guild, updatedMeeting, 'invite');
				}
			}
		}
	} catch (error) {
		logger.error('[CALCOM_SYNC] Booking sync failed', error);
	}
}

module.exports = {
	syncCalcomBookings,
	getEventsChannel
};
