const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const meetingsDb = require('./meetingsDb');
const config = require('../config');

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
		// Find or create 'EVENTS' category
		let category = guild.channels.cache.find(c => c.name.toUpperCase() === 'EVENTS' && c.type === ChannelType.GuildCategory);
		if (!category) {
			category = await guild.channels.create({
				name: 'EVENTS',
				type: ChannelType.GuildCategory
			}).catch(() => null);
		}

		// Setup permissions
		const STAFF_ROLE_ID = '1480620981587279993';
		const overwrites = [
			{
				id: guild.roles?.everyone?.id || 'everyone_role_id',
				deny: [PermissionFlagsBits.ViewChannel]
			},
			{
				id: meeting.creator_id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
			}
		];

		const staffRole = guild.roles?.cache?.get(STAFF_ROLE_ID);
		if (staffRole) {
			overwrites.push({
				id: staffRole.id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
			});
		}

		for (const attendee of meeting.attendees) {
			overwrites.push({
				id: attendee.discordId,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
			});
		}

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

module.exports = {
	resolveAttendeeUserIds,
	createMeetingVoiceChannel,
	sendMeetingDMs
};
