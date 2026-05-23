const cron = require('node-cron');
const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');
const { resolveAttendeeUserIds, createMeetingVoiceChannel, sendMeetingDMs } = require('../lib/meetingsHelper');

module.exports = (client) => {
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
					const sent = await meetingsDb.hasReminderBeenSent(meeting.id, '12h');
					if (!sent) {
						await sendChannelReminder(guild, meeting, '12 hours');
						await meetingsDb.recordReminderSent(meeting.id, '12h');
					}
				}

				// Case 2: 30 Minutes Remaining
				if (timeDiff <= 30 * 60 * 1000 && timeDiff > 25 * 60 * 1000) {
					const sent = await meetingsDb.hasReminderBeenSent(meeting.id, '30m');
					if (!sent) {
						await sendChannelReminder(guild, meeting, '30 minutes');
						await meetingsDb.recordReminderSent(meeting.id, '30m');
					}
				}

				// Case 3: 5 Minutes Remaining (VC Creation & Notification)
				if (timeDiff <= 5 * 60 * 1000 && timeDiff > 0) {
					const sent = await meetingsDb.hasReminderBeenSent(meeting.id, '5m');
					if (!sent) {
						let vcLink = '';
						
						if (meeting.location_type === 'discord_vc') {
							const vcChannel = await createMeetingVoiceChannel(guild, meeting);
							if (vcChannel) {
								vcLink = `https://discord.com/channels/${guild.id}/${vcChannel.id}`;
							}
						}

						await sendChannelReminder(guild, meeting, '5 minutes', vcLink);
						await sendMeetingDMs(guild, meeting, vcLink);
						await meetingsDb.recordReminderSent(meeting.id, '5m');
					}
				}

				// Case 4: Meeting Commencement Time
				if (now >= meeting.scheduled_time) {
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
					const vcChannel = guild.channels.cache.get(meeting.temp_channel_id);
					
					if (!vcChannel) {
						// VC was deleted manually or crashed, mark complete
						await meetingsDb.updateMeetingStatus(meeting.id, 'completed');
						continue;
					}

					// Stale cleanup: if VC has been empty for > 30 minutes after start time
					const durationActive = now - meeting.scheduled_time;
					if (durationActive > 30 * 60 * 1000 && vcChannel.members.size === 0) {
						console.log(`[MEETING] VC empty for over 30 mins. Cleaning up meeting "${meeting.title}"...`);
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
						const eventsChannel = guild.channels.cache.find(c => c.name === 'events' || c.name === 'pulse' || c.name === 'leads-council');
						
						for (const userId of missingUsers) {
							const lastPing = await meetingsDb.getLastPingTime(meeting.id, userId);
							
							// Ping every 5 minutes
							if (now - lastPing >= 5 * 60 * 1000) {
								if (eventsChannel) {
									await eventsChannel.send(
										`⚠️ <@${userId}>, you are required in the meeting "**${meeting.title}**". Please join the voice channel: https://discord.com/channels/${guild.id}/${meeting.temp_channel_id}`
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
	const eventsChannel = guild.channels.cache.find(c => c.name === 'events' || c.name === 'pulse' || c.name === 'leads-council');
	if (!eventsChannel) return;

	const tags = meeting.attendees.map(a => a.type === 'user' ? `<@${a.discordId}>` : `<@&${a.discordId}>`).join(' ');

	const embed = new EmbedBuilder()
		.setTitle(`${config.EMOJIS.reminder} MEETING_REMINDER // ${timeLabel.toUpperCase()}_REMAINING`)
		.setDescription(`The meeting "**${meeting.title}**" starts in ${timeLabel}.`)
		.addFields(
			{ name: '📅 START TIME', value: `<t:${Math.floor(meeting.scheduled_time / 1000)}:F> (<t:${Math.floor(meeting.scheduled_time / 1000)}:R>)`, inline: false }
		)
		.setColor(config.COLORS.warning)
		.setTimestamp()
		.setFooter({ text: config.BRANDING.footerText });

	if (vcLink) {
		embed.addFields({ name: '🔊 JOIN VC NOW', value: `[Click here to connect](${vcLink})`, inline: false });
	} else if (meeting.location_type === 'external') {
		embed.addFields({ name: '🌐 LOCATION', value: meeting.location_details || 'External link', inline: false });
	}

	await eventsChannel.send({
		content: `🔔 **Reminder**: ${tags}`,
		embeds: [embed]
	});
}

async function sendCommencementNotification(guild, meeting) {
	const eventsChannel = guild.channels.cache.find(c => c.name === 'events' || c.name === 'pulse' || c.name === 'leads-council');
	if (!eventsChannel) return;

	const tags = meeting.attendees.map(a => a.type === 'user' ? `<@${a.discordId}>` : `<@&${a.discordId}>`).join(' ');

	const embed = new EmbedBuilder()
		.setTitle(`⚛️ MEETING_COMMENCEMENT // LIVE`)
		.setDescription(`The meeting "**${meeting.title}**" is starting now!`)
		.setColor(config.COLORS.primary)
		.setTimestamp()
		.setFooter({ text: config.BRANDING.footerText });

	if (meeting.location_type === 'discord_vc' && meeting.temp_channel_id) {
		const vcLink = `https://discord.com/channels/${guild.id}/${meeting.temp_channel_id}`;
		embed.addFields({ name: '🔊 VOICE CHANNEL', value: `[Click to Join Channel](${vcLink})`, inline: false });
	} else if (meeting.location_type === 'external') {
		embed.addFields({ name: '🌐 LOCATION', value: meeting.location_details || 'External link', inline: false });
	}

	await eventsChannel.send({
		content: `🚨 **Meeting starting now**: ${tags}`,
		embeds: [embed]
	});
}
