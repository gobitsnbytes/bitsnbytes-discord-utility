const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const meetingsDb = require('./meetingsDb');
const config = require('../config');
const { getStaffRole } = require('./auth');

/**
 * Resolves a structured scope string into Discord permission overwrites.
 *
 * Scope formats:
 *   'invite'              → no extra allows; only explicit attendees have access
 *   'open'               → all `contributor` + all `hq` role members
 *   'hq'                 → `hq` role members only (Foundation team)
 *   'fork:{city}'        → `contributor-{city}` role members (entire fork)
 *   'network:{track}'    → global `{track}` role members (e.g. tech, outreach-lead)
 *   'fork:{city}:{track}'→ TRUE intersection — per-user overrides for members
 *                          with BOTH `contributor-{city}` AND `{track}` roles
 *
 * @param {string} scopeStr - The scope value from the meeting record
 * @param {Guild} guild - The Discord Guild object
 * @returns {Promise<Array>} Array of permission overwrite objects
 */
async function parseScope(scopeStr, guild) {
	const allows = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
	const overwrites = [];

	if (!scopeStr || scopeStr === 'invite') return overwrites;

	const contributorRole = guild.roles?.cache?.get(config.ROLE_IDS.contributor) ||
		guild.roles?.cache?.find(r => r.name.toLowerCase() === 'builder') ||
		guild.roles?.cache?.find(r => r.name.toLowerCase() === 'contributor');
	const hqRole = guild.roles?.cache?.find(r => r.name.toLowerCase() === 'hq');

	if (scopeStr === 'open') {
		// All contributors (fork members) + all HQ members
		if (contributorRole) overwrites.push({ id: contributorRole.id, allow: allows });
		if (hqRole) overwrites.push({ id: hqRole.id, allow: allows });
		return overwrites;
	}

	if (scopeStr === 'hq') {
		if (hqRole) overwrites.push({ id: hqRole.id, allow: allows });
		else console.warn('[MEETING] hq role not found in guild for scope "hq".');
		return overwrites;
	}

	const parts = scopeStr.split(':');

	if (parts[0] === 'network') {
		// network:{track} — e.g. network:tech, network:outreach-lead, network:tech-lead
		const trackName = parts.slice(1).join(':').toLowerCase();
		const trackRole = guild.roles?.cache?.find(r => r.name.toLowerCase() === trackName);
		if (trackRole) {
			overwrites.push({ id: trackRole.id, allow: allows });
		} else {
			console.warn(`[MEETING] Network track role "${trackName}" not found. Falling back to open.`);
			if (contributorRole) overwrites.push({ id: contributorRole.id, allow: allows });
			if (hqRole) overwrites.push({ id: hqRole.id, allow: allows });
		}
		return overwrites;
	}

	if (parts[0] === 'fork') {
		const city = parts[1]?.toLowerCase();
		const track = parts[2]?.toLowerCase();

		const cityContribRole = city
			? guild.roles?.cache?.find(r => r.name.toLowerCase() === `contributor-${city}`)
			: null;

		if (!track) {
			// fork:{city} — entire fork
			if (cityContribRole) {
				overwrites.push({ id: cityContribRole.id, allow: allows });
			} else {
				console.warn(`[MEETING] contributor-${city} role not found. Falling back to open.`);
				if (contributorRole) overwrites.push({ id: contributorRole.id, allow: allows });
			}
			return overwrites;
		}

		// fork:{city}:{track} — TRUE intersection via per-user overrides
		const trackRole = guild.roles?.cache?.find(r => r.name.toLowerCase() === track);

		if (cityContribRole && trackRole) {
			// Ensure member cache is fully populated before iterating
			await guild.members.fetch().catch(() => {});
			const matched = guild.members.cache.filter(m =>
				m.roles.cache.has(cityContribRole.id) && m.roles.cache.has(trackRole.id)
			);
			matched.forEach(member => {
				// type: 1 = member-level override
				overwrites.push({ id: member.id, allow: allows, type: 1 });
			});
			if (matched.size === 0) {
				console.warn(`[MEETING] No members found with both contributor-${city} and ${track} roles. Falling back to city role.`);
				if (cityContribRole) overwrites.push({ id: cityContribRole.id, allow: allows });
			}
		} else if (cityContribRole) {
			console.warn(`[MEETING] Track role "${track}" not found; falling back to city-only scope.`);
			overwrites.push({ id: cityContribRole.id, allow: allows });
		} else {
			console.warn(`[MEETING] Neither contributor-${city} nor ${track} roles found. Falling back to open.`);
			if (contributorRole) overwrites.push({ id: contributorRole.id, allow: allows });
		}
		return overwrites;
	}

	// Unknown scope — fall back to open
	console.warn(`[MEETING] Unknown scope "${scopeStr}". Falling back to open.`);
	if (contributorRole) overwrites.push({ id: contributorRole.id, allow: allows });
	if (hqRole) overwrites.push({ id: hqRole.id, allow: allows });
	return overwrites;
}

// Helper to resolve all user IDs from meeting attendees
async function resolveAttendeeUserIds(guild, attendees) {
	const userIds = new Set();
	let fetchedAllMembers = false;
	
	for (const attendee of attendees || []) {
		if (attendee.type === 'user') {
			userIds.add(attendee.discordId);
		} else if (attendee.type === 'role') {
			try {
				const role = guild.roles?.cache?.get(attendee.discordId);
				if (role) {
					// Fetch members only once per call to resolve roles instead of every loop iteration
					if (!fetchedAllMembers) {
						await guild.members.fetch().catch(() => {});
						fetchedAllMembers = true;
					}
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

function cleanVcName(title, meetCode) {
	let clean = title.trim();
	
	// Strip "Person A <> Person B: " or "Person A & Person B: "
	const calcomPattern = /^[^\n<>]+(?:\s+(?:<>|&)\s+[^\n:]+):\s*(.+)$/i;
	const match = clean.match(calcomPattern);
	if (match && match[1]) {
		clean = match[1].trim();
	}
	
	// If it still contains "<>" or "&" or is just names, and we have a meet code, use the meet code instead
	if ((clean.includes('<>') || clean.includes('&')) && meetCode) {
		return `meet-${meetCode}`;
	}
	
	// Truncate to maximum 30 characters
	if (clean.length > 30) {
		clean = clean.substring(0, 27) + '...';
	}
	
	return clean;
}

async function createMeetingVoiceChannel(guild, meeting) {
	try {
		// If meeting already has a channel ID, check if it exists in the guild
		if (meeting.temp_channel_id) {
			const existingChannel = guild.channels.cache.get(meeting.temp_channel_id) || await guild.channels.fetch(meeting.temp_channel_id).catch(() => null);
			if (existingChannel) {
				return existingChannel;
			}
		}

		const staffRole = getStaffRole(guild);
		const contributorRole = guild.roles?.cache?.get(config.ROLE_IDS.contributor) ||
			guild.roles?.cache?.find(r => r.name.toLowerCase() === 'builder') ||
			guild.roles?.cache?.find(r => r.name.toLowerCase() === 'contributor');

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

		// Resolve scope-based permission overwrites using structured scope string
		if (meeting.scope && meeting.scope !== 'invite') {
			try {
				const scopeOverwrites = await parseScope(meeting.scope, guild);
				if (scopeOverwrites.length === 0) {
					// Nothing resolved — lock to invite-only (safest fallback)
					console.warn(`[MEETING] Scope "${meeting.scope}" resolved to 0 overwrites. Channel will be invite-only.`);
				} else {
					for (const ow of scopeOverwrites) {
						overwritesMap.set(ow.id, ow);
					}
				}
			} catch (err) {
				console.error('[MEETING] Error resolving scope overrides:', err.message);
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
		const shortName = cleanVcName(meeting.title, meeting.meet_code);
		const vcChannel = await guild.channels.create({
			name: `🔊 ${shortName}`,
			type: ChannelType.GuildVoice,
			parent: category ? category.id : null,
			permissionOverwrites: overwrites
		}).catch(err => {
			console.error(`[MEETING] VC creation failed:`, err.message);
			return null;
		});

		if (vcChannel) {
			await meetingsDb.setTempChannelId(meeting.id, vcChannel.id);
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

					if (meeting.meet_code) {
						embed.addFields({ name: '🔗 MEETING LINK', value: `https://cal.gobitsnbytes.org/m/${meeting.meet_code}`, inline: false });
					} else if (vcLink) {
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

		// 5. Generate meeting landing page URL to avoid bare links
		let vcLink = '';
		if (meeting.meet_code) {
			vcLink = `https://cal.gobitsnbytes.org/m/${meeting.meet_code}`;
		} else if (meeting.location_type === 'discord_vc') {
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

		const tags = (meeting.attendees || []).map(a => a.type === 'user' ? `<@${a.discordId}>` : `<@&${a.discordId}>`).join(' ');

		const embed = new EmbedBuilder()
			.setTitle(`⚛️ MEETING_COMMENCEMENT // LIVE`)
			.setDescription(`The meeting "**${meeting.title}**" is starting now!`)
			.addFields({ name: '🆔 MEETING ID', value: `\`${meeting.id}\``, inline: false })
			.setColor(config.COLORS.primary)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		if (meeting.meet_code) {
			embed.addFields({ name: '🔗 MEETING LINK', value: `https://cal.gobitsnbytes.org/m/${meeting.meet_code}`, inline: false });
		} else if (meeting.location_type === 'discord_vc' && meeting.temp_channel_id) {
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
	parseScope,
	resolveAttendeeUserIds,
	createMeetingVoiceChannel,
	sendMeetingDMs,
	sendMeetingEmails,
	sendCommencementNotification,
	sendRescheduleDMs
};
