const cron = require('node-cron');
const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');
const meetingsHelper = require('../lib/meetingsHelper');
const { resolveAttendeeUserIds, createMeetingVoiceChannel, sendMeetingDMs, sendMeetingEmails, sendCommencementNotification } = meetingsHelper;
const { getEventsChannel, syncCalcomBookings } = require('../lib/calcomWebhook');
const { stopRecording } = require('../lib/voiceRecorder');
const { queueTranscription } = require('../lib/transcriptionPipeline');

module.exports = (client) => {
	// Run Cal.com sync every 2 minutes
	cron.schedule('*/2 * * * *', async () => {
		try {
			await syncCalcomBookings(client);
		} catch (error) {
			console.error('[MEETING SCHEDULER] Cal.com sync job error:', error);
		}
	});

	// Run every minute
	cron.schedule('* * * * *', async () => {
		const guild = client.guilds.cache.first();
		if (!guild) return;

		// 1. Process Scheduled (Upcoming) Meetings
		try {
			const upcoming = await meetingsDb.getUpcomingMeetings();
			const now = Date.now();

			for (const meeting of upcoming) {
				const timeDiff = meeting.scheduled_time - now;

				// Case 1: 12 Hours Remaining
				if (timeDiff <= 12 * 60 * 60 * 1000 && timeDiff > 11.5 * 60 * 60 * 1000) {
					if (await meetingsDb.tryClaimReminder(meeting.id, '12h')) {
						await sendChannelReminder(guild, meeting, '12 hours');
						await sendMeetingEmails(guild, meeting, 'reminder', '12 hours');
					}
				}

				// Case 2: 30 Minutes Remaining
				if (timeDiff <= 30 * 60 * 1000 && timeDiff > 25 * 60 * 1000) {
					if (await meetingsDb.tryClaimReminder(meeting.id, '30m')) {
						await sendChannelReminder(guild, meeting, '30 minutes');
						await sendMeetingEmails(guild, meeting, 'reminder', '30 minutes');
					}
				}

				// Case 3: 5 Minutes Remaining (VC Creation & Notification)
				if (timeDiff <= 5 * 60 * 1000 && timeDiff > 0) {
					if (await meetingsDb.tryClaimReminder(meeting.id, '5m')) {
						let vcLink = '';
						
						if (meeting.location_type === 'discord_vc') {
							const vcChannel = await createMeetingVoiceChannel(guild, meeting);
							if (vcChannel) {
								vcLink = `https://discord.com/channels/${guild.id}/${vcChannel.id}`;
							}
						}

						await sendChannelReminder(guild, meeting, '5 minutes', vcLink);
						await sendMeetingDMs(guild, meeting, vcLink);
					}
				}

				// Case 4: Meeting Commencement Time
				if (now >= meeting.scheduled_time) {
					if (await meetingsDb.tryClaimReminder(meeting.id, 'commencement')) {
						if (meeting.location_type === 'discord_vc') {
							await meetingsDb.updateMeetingStatus(meeting.id, 'active');
							await sendCommencementNotification(guild, meeting);
						} else {
							// For external location, automatically mark complete
							await meetingsDb.updateMeetingStatus(meeting.id, 'completed');
							await sendCommencementNotification(guild, meeting);
						}
					}
				}
			}
		} catch (error) {
			console.error('[MEETING SCHEDULER ERROR] Error processing upcoming meetings:', error);
		}

		// 2. Process Active Meetings (Attendance checks every 5 minutes)
		try {
			const activeMeetings = await meetingsDb.getActiveMeetings();
			const now = Date.now();

			for (const meeting of activeMeetings) {
				// Attendance Check
				if (meeting.location_type === 'discord_vc' && meeting.temp_channel_id) {
					const vcChannel = guild.channels.cache.get(meeting.temp_channel_id) || await guild.channels.fetch(meeting.temp_channel_id).catch(() => null);
					
					if (!vcChannel) {
						// VC was deleted manually or crashed, mark complete
						await meetingsDb.updateMeetingStatus(meeting.id, 'completed');
						continue;
					}

					// Get correct VC members (handling listener bot pool)
					let humanCount = 0;
					const { getActiveRecordings } = require('../lib/voiceRecorder');
					const recordingSession = getActiveRecordings().get(meeting.id);
					if (recordingSession && recordingSession.client) {
						try {
							const recGuild = await recordingSession.client.guilds.fetch(guild.id).catch(() => null);
							const recChannel = recGuild ? await recGuild.channels.fetch(meeting.temp_channel_id).catch(() => null) : null;
							if (recChannel) {
								humanCount = recChannel.members.filter(m => !m.user.bot).size;
							}
						} catch (recErr) {
							console.warn(`[SCHEDULER] Failed to check members via recording client:`, recErr.message);
							humanCount = vcChannel.members.filter(m => !m.user.bot).size;
						}
					} else {
						humanCount = vcChannel.members.filter(m => !m.user.bot).size;
					}

					// Stale cleanup: if VC has been empty for > 30 minutes after start time
					const startTime = meeting.activated_at || meeting.scheduled_time;
					const durationActive = now - startTime;
					if (durationActive > 30 * 60 * 1000 && humanCount === 0) {
						console.log(`[MEETING] VC empty for over 30 mins. Cleaning up meeting "${meeting.title}"...`);

						// Stop recording and queue transcription BEFORE deleting the channel
						// (mirrors the same flow in voiceStateUpdate.js to prevent transcript loss)
						if (process.env.RECORDING_ENABLED === 'true') {
							try {
								const recordingData = await stopRecording(meeting.id);
								if (recordingData) {
									console.log(`[MEETING] Queuing transcription for stale-cleaned meeting "${meeting.title}" (${meeting.id})`);
									queueTranscription(meeting, recordingData, client).catch(err => {
										console.error(`[MEETING] Transcription pipeline error for ${meeting.id}:`, err);
									});
								}
							} catch (recErr) {
								console.error(`[MEETING] Error stopping recording during stale cleanup for ${meeting.id}:`, recErr);
							}
						}

						await vcChannel.delete('Stale meeting VC deleted.').catch(() => {});
						await meetingsDb.updateMeetingStatus(meeting.id, 'completed');
						continue;
					}

					// Fetch all attendee User IDs
					const requiredUserIds = await resolveAttendeeUserIds(guild, meeting.attendees);
					// Filter out creator
					requiredUserIds.add(meeting.creator_id);

					// Get users currently in VC
					const currentInVc = new Set(vcChannel.members.keys());

					// Find who is missing
					const missingUsers = [];
					for (const userId of requiredUserIds) {
						if (!currentInVc.has(userId)) {
							missingUsers.push(userId);
						}
					}

					// Send pings for missing users
					if (missingUsers.length > 0) {
						const eventsChannel = await getEventsChannel(guild);
						
						for (const userId of missingUsers) {
							const lastPing = await meetingsDb.getLastPingTime(meeting.id, userId);
							
							// Ping every 5 minutes
							if (now - lastPing >= 5 * 60 * 1000) {
								if (eventsChannel) {
									await eventsChannel.send(
										`⚠️ <@${userId}>, you are required in the meeting "**${meeting.title}**". Please join here: https://cal.gobitsnbytes.org/m/${meeting.meet_code}`
									);
								}
								await meetingsDb.updateLastPingTime(meeting.id, userId);
							}
						}
					}
				}
			}
		} catch (error) {
			console.error('[MEETING SCHEDULER ERROR] Error processing active meetings:', error);
		}
	});
};

async function sendChannelReminder(guild, meeting, timeLabel, vcLink = '') {
	const eventsChannel = await getEventsChannel(guild);
	if (!eventsChannel) return;

	const tags = (meeting.attendees || []).map(a => a.type === 'user' ? `<@${a.discordId}>` : `<@&${a.discordId}>`).join(' ');

	const embed = new EmbedBuilder()
		.setTitle(`${config.EMOJIS.reminder} MEETING_REMINDER // ${timeLabel.toUpperCase()}_REMAINING`)
		.setDescription("The meeting \"**" + meeting.title + "**\" starts in " + timeLabel + ".")
		.addFields(
			{ name: '📅 START TIME', value: `<t:${Math.floor(meeting.scheduled_time / 1000)}:F> (<t:${Math.floor(meeting.scheduled_time / 1000)}:R>)`, inline: false }
		)
		.setColor(config.COLORS.warning)
		.setTimestamp()
		.setFooter({ text: config.BRANDING.footerText });

	if (meeting.meet_code) {
		embed.addFields({ name: '🔗 MEETING LINK', value: `https://cal.gobitsnbytes.org/m/${meeting.meet_code}`, inline: false });
	} else if (vcLink) {
		embed.addFields({ name: '🔊 JOIN VC NOW', value: `[Click here to connect](${vcLink})`, inline: false });
	} else if (meeting.location_type === 'external') {
		embed.addFields({ name: '🌐 LOCATION', value: meeting.location_details || 'External link', inline: false });
	}

	await eventsChannel.send({
		content: `🔔 **Reminder**: ${tags}`,
		embeds: [embed]
	});
}


