const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const meetingsDb = require('./meetingsDb');
const config = require('../config');
const { getStaffRole } = require('./auth');

// Helper to resolve all user IDs from meeting attendees
async function resolveAttendeeUserIds(guild, attendees) {
	const userIds = new Set();
	
	for (const attendee of attendees) {
		if (attendee.type === 'user') {
			userIds.add(attendee.discordId);
		} else if (attendee.type === 'role') {
			try {
				const role = guild.roles?.cache?.get(attendee.discordId);
				if (role) {
					// Fetch members to ensure cache is populated
					await guild.members.fetch();
					role.members.forEach(member => {
						userIds.add(member.id);
					});
				}
			} catch (err) {
				console.error(`[MEETING] Error fetching members for role ${attendee.discordId}:`, err.message);
			}
		}
	}
	
	return userIds;
}

async function createMeetingVoiceChannel(guild, meeting) {
	try {
		// If meeting already has a channel ID, check if it exists in the guild
		if (meeting.temp_channel_id) {
			const existingChannel = guild.channels.cache.get(meeting.temp_channel_id);
			if (existingChannel) {
				return existingChannel;
			}
		}

		const staffRole = getStaffRole(guild);
		const contributorRole = guild.roles?.cache?.get('1506019068132462804') || guild.roles?.cache?.find(r => r.name.toLowerCase() === 'contributor');

		// Setup category permission overrides to deny ViewChannel to @everyone by default
		const categoryOverwritesMap = new Map();
		
		categoryOverwritesMap.set(guild.roles?.everyone?.id || guild.id, {
			id: guild.roles?.everyone?.id || guild.id,
			deny: [PermissionFlagsBits.ViewChannel]
		});
		
		categoryOverwritesMap.set(guild.client?.user?.id || 'bot_client_id', {
			id: guild.client?.user?.id || 'bot_client_id',
			allow: [
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.Connect,
				PermissionFlagsBits.Speak,
				PermissionFlagsBits.MuteMembers,
				PermissionFlagsBits.DeafenMembers,
				PermissionFlagsBits.MoveMembers,
				PermissionFlagsBits.ManageChannels
			]
		});

		if (staffRole) {
			categoryOverwritesMap.set(staffRole.id, {
				id: staffRole.id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
			});
		}


		const categoryOverwrites = Array.from(categoryOverwritesMap.values());

		// Find or create 'EVENTS' category
		const categoryId = process.env.MEETINGS_CATEGORY_ID || '1490416248000090122';
		let category = null;
		if (guild.channels.cache && typeof guild.channels.cache.get === 'function') {
			category = guild.channels.cache.get(categoryId);
		}
		if (!category || category.type !== ChannelType.GuildCategory) {
			category = guild.channels.cache.find(c => c.name.toUpperCase() === 'EVENTS' && c.type === ChannelType.GuildCategory);
		}

		if (!category) {
			category = await guild.channels.create({
				name: 'EVENTS',
				type: ChannelType.GuildCategory,
				permissionOverwrites: categoryOverwrites
			}).catch(() => null);
		} else if (category.permissionOverwrites && typeof category.permissionOverwrites.set === 'function') {
			// Proactively update/tighten category permissions
			await category.permissionOverwrites.set(categoryOverwrites).catch(err => {
				console.warn(`[MEETING] Failed to tighten permissions on category ${category.name}:`, err.message);
			});
		}

		// Setup permissions
		const overwritesMap = new Map();
		overwritesMap.set(guild.roles?.everyone?.id || 'everyone_role_id', {
			id: guild.roles?.everyone?.id || 'everyone_role_id',
			deny: [PermissionFlagsBits.ViewChannel]
		});
		overwritesMap.set(guild.client?.user?.id || 'bot_client_id', {
			id: guild.client?.user?.id || 'bot_client_id',
			allow: [
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.Connect,
				PermissionFlagsBits.Speak,
				PermissionFlagsBits.MuteMembers,
				PermissionFlagsBits.DeafenMembers,
				PermissionFlagsBits.MoveMembers
			]
		});
		overwritesMap.set(meeting.creator_id, {
			id: meeting.creator_id,
			allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
		});

		// If meeting scope is open, handle permission overrides dynamically
		if (meeting.scope === 'open') {
			try {
				let grantedOpenScope = false;

				if (contributorRole) {
					overwritesMap.set(contributorRole.id, {
						id: contributorRole.id,
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
					});
					grantedOpenScope = true;
				}

				const db = require('./db');
				const creatorAvail = await db.get('SELECT associated_role_id FROM user_availability WHERE discord_id = ?', [meeting.creator_id]).catch(() => null);
				if (creatorAvail && creatorAvail.associated_role_id) {
					overwritesMap.set(creatorAvail.associated_role_id, {
						id: creatorAvail.associated_role_id,
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
					});
					grantedOpenScope = true;
				}

				// If no contributor roles could be resolved/applied, fall back to everyone (to avoid locked voice channels)
				if (!grantedOpenScope) {
					console.warn('[MEETING] Neither general contributor role nor creator fork role was found. Falling back to everyone.');
					const everyoneId = guild.roles?.everyone?.id || 'everyone_role_id';
					overwritesMap.set(everyoneId, {
						id: everyoneId,
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
					});
				}
			} catch (err) {
				console.error('[MEETING] Error setting open scope overrides:', err.message);
			}
		} else if (['tech', 'creative', 'ops', 'outreach'].includes(meeting.scope?.toLowerCase())) {
			try {
				const trackScope = meeting.scope.toLowerCase();
				let targetRole = guild.roles?.cache?.find(r => r.name.toLowerCase() === trackScope);
				if (!targetRole && trackScope === 'creative') {
					targetRole = guild.roles?.cache?.find(r => r.name.toLowerCase() === 'design');
				}
				if (targetRole) {
					overwritesMap.set(targetRole.id, {
						id: targetRole.id,
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
					});
				} else {
					console.warn(`[MEETING] Scoped track role "${trackScope}" not found in guild. Falling back to open scope.`);
					if (contributorRole) {
						overwritesMap.set(contributorRole.id, {
							id: contributorRole.id,
							allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
						});
					}
				}
			} catch (err) {
				console.error('[MEETING] Error setting track scope overrides:', err.message);
			}
		}
		if (staffRole) {
			overwritesMap.set(staffRole.id, {
				id: staffRole.id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
			});
		}

		for (const attendee of meeting.attendees) {
			overwritesMap.set(attendee.discordId, {
				id: attendee.discordId,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
			});
		}

		const overwrites = Array.from(overwritesMap.values());

		// Create Voice Channel
		const vcChannel = await guild.channels.create({
			name: `🔊 ${meeting.title}`,
			type: ChannelType.GuildVoice,
			parent: category ? category.id : null,
			permissionOverwrites: overwrites
		}).catch(err => {
			console.error(`[MEETING] VC creation failed:`, err.message);
			return null;
		});

		if (vcChannel) {
			await meetingsDb.setTempChannelId(meeting.id, vcChannel.id);

			// Auto-start recording (always-on when enabled)
			if (process.env.RECORDING_ENABLED === 'true') {
				try {
					const { startRecording } = require('./voiceRecorder');
					await startRecording(vcChannel, meeting.id, guild.client);
					console.log(`[MEETING] Recording started for "${meeting.title}" (${meeting.id})`);
				} catch (err) {
					console.error(`[MEETING] Failed to start recording for "${meeting.title}":`, err.message);
					// Non-fatal: meeting continues without recording
				}
			}

			return vcChannel;
		}
	} catch (err) {
		console.error(`[MEETING] Error in createMeetingVoiceChannel:`, err);
	}
	return null;
}

async function sendMeetingDMs(guild, meeting, vcLink) {
	try {
		const userIds = await resolveAttendeeUserIds(guild, meeting.attendees);
		
		for (const userId of userIds) {
			try {
				const member = await guild.members.fetch(userId).catch(() => null);
				if (member && !member.user?.bot) {
					const embed = new EmbedBuilder()
						.setTitle(`🔔 MEETING_ALERT // VC_READY`)
						.setDescription(`The meeting "**${meeting.title}**" starts soon! The temporary voice channel is now available.`)
						.addFields(
							{ name: '📅 START TIME', value: `<t:${Math.floor(meeting.scheduled_time / 1000)}:F> (<t:${Math.floor(meeting.scheduled_time / 1000)}:R>)`, inline: false }
						)
						.setColor(config.COLORS.primary)
						.setTimestamp()
						.setFooter({ text: config.BRANDING.footerText });

					if (vcLink) {
						embed.addFields({ name: '🔊 JOIN VOICE CHANNEL', value: `[Click here to connect](${vcLink})`, inline: false });
					} else if (meeting.location_type === 'external') {
						embed.addFields({ name: '🌐 LOCATION', value: meeting.location_details || 'External link', inline: false });
					}

					await member.send({ embeds: [embed] }).catch(() => {});
				}
			} catch (dmErr) {
				console.warn(`[MEETING] Could not send DM to user ${userId}:`, dmErr.message);
			}
		}
	} catch (err) {
		console.error(`[MEETING] Error in sendMeetingDMs:`, err);
	}
}

async function sendMeetingEmails(guild, meeting, type, timeLabel = '30 minutes', rescheduleData = null) {
	try {
		const mailer = require('./mailer');
		
		// 1. Resolve Discord user IDs
		const userIds = Array.from(await resolveAttendeeUserIds(guild, meeting.attendees));
		
		// 2. Fetch email addresses for those users
		const userEmailMap = await meetingsDb.getUserEmails(userIds);
		const emails = Object.values(userEmailMap);

		// 3. Add external/ad-hoc emails
		if (meeting.externalEmails && Array.isArray(meeting.externalEmails)) {
			for (const email of meeting.externalEmails) {
				if (email && !emails.includes(email)) {
					emails.push(email);
				}
			}
		}

		if (emails.length === 0) {
			console.log(`[MEETING_EMAIL] No emails found for meeting "${meeting.title}" (ID: ${meeting.id})`);
			return;
		}

		// 4. Format time in IST
		const formattedTime = new Date(meeting.scheduled_time).toLocaleString('en-US', {
			timeZone: 'Asia/Kolkata',
			hour12: true,
			hour: 'numeric',
			minute: '2-digit',
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}) + ' IST';

		// 5. Generate voice channel deep link if active/available
		let vcLink = '';
		if (meeting.location_type === 'discord_vc') {
			if (meeting.temp_channel_id) {
				vcLink = `https://discord.com/channels/${guild.id}/${meeting.temp_channel_id}`;
			} else {
				vcLink = 'Discord Temporary VC';
			}
		} else if (meeting.location_details) {
			vcLink = meeting.location_details;
		}

		// 6. Send based on type
		if (type === 'invite') {
			await mailer.sendMeetingInvite(emails, meeting, formattedTime, vcLink, guild.id);
		} else if (type === 'reminder') {
			await mailer.sendMeetingReminder(emails, meeting, formattedTime, vcLink, timeLabel);
		} else if (type === 'cancel') {
			await mailer.sendMeetingCancellation(emails, meeting, formattedTime);
		} else if (type === 'reschedule' && rescheduleData) {
			await mailer.sendMeetingReschedule(emails, meeting, rescheduleData.oldTime, rescheduleData.newTime, rescheduleData.reason, rescheduleData.rescheduledByName, vcLink, guild.id);
		}
	} catch (err) {
		console.error(`[MEETING_EMAIL] Failed to send meeting emails:`, err);
	}
}

async function sendCommencementNotification(guild, meeting) {
	try {
		const { getEventsChannel } = require('./calcomWebhook');
		const eventsChannel = await getEventsChannel(guild);
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
	} catch (err) {
		console.error(`[MEETING] Error in sendCommencementNotification:`, err);
	}
}

async function sendRescheduleDMs(guild, meeting, oldTimeMs, newTimeMs, reason, rescheduledByName) {
	try {
		const userIds = await resolveAttendeeUserIds(guild, meeting.attendees);

		for (const userId of userIds) {
			try {
				const member = await guild.members.fetch(userId).catch(() => null);
				if (member && !member.user?.bot) {
					const embed = new EmbedBuilder()
						.setTitle(`🔄 MEETING_RESCHEDULED`)
						.setDescription(`The meeting "**${meeting.title}**" has been rescheduled.`)
						.addFields(
							{ name: '📅 ORIGINAL TIME', value: `<t:${Math.floor(oldTimeMs / 1000)}:F>`, inline: false },
							{ name: '📅 NEW TIME', value: `<t:${Math.floor(newTimeMs / 1000)}:F> (<t:${Math.floor(newTimeMs / 1000)}:R>)`, inline: false },
							{ name: '📝 REASON', value: reason, inline: false },
							{ name: '👤 RESCHEDULED BY', value: rescheduledByName, inline: false }
						)
						.setColor(0xffae24)
						.setTimestamp()
						.setFooter({ text: config.BRANDING.footerText });

					if (meeting.meet_code) {
						embed.addFields({ name: '🔗 MEETING LINK', value: `https://cal.gobitsnbytes.org/m/${meeting.meet_code}`, inline: false });
					}

					await member.send({ embeds: [embed] }).catch(() => {});
				}
			} catch (dmErr) {
				console.warn(`[MEETING] Could not send reschedule DM to user ${userId}:`, dmErr.message);
			}
		}
	} catch (err) {
		console.error(`[MEETING] Error in sendRescheduleDMs:`, err);
	}
}

module.exports = {
	resolveAttendeeUserIds,
	createMeetingVoiceChannel,
	sendMeetingDMs,
	sendMeetingEmails,
	sendCommencementNotification,
	sendRescheduleDMs
};
