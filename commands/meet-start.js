const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');
const { sendCommencementNotification, resolveAttendeeUserIds } = require('../lib/meetingsHelper');
const { isStaff, getForkLeadRole } = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('meet-start')
		.setDescription('Manually start a scheduled or pending meeting and notify guests.')
		.addStringOption(option => 
			option.setName('meeting-id')
				.setDescription('The ID of the meeting to start (optional if you are in the meeting VC)')
				.setRequired(false)
				.setAutocomplete(true)),

	async execute(interaction) {
		const member = await interaction.guild.members.fetch(interaction.user.id);
		
		const staffCheck = isStaff(member, interaction.guild);
		const forkLeadRole = getForkLeadRole(interaction.guild);
		const isForkLead = forkLeadRole && member.roles.cache.has(forkLeadRole.id);
		
		const isAuthorized = staffCheck || isForkLead || member.permissions.has('Administrator');
		
		if (!isAuthorized) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
				.setDescription('Your credentials do not grant access to start meetings.')
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			return await interaction.reply({ 
				embeds: [unauthorizedEmbed], 
				flags: [MessageFlags.Ephemeral] 
			});
		}

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			const { callMotherboard } = require('../lib/motherboardApi');
			let meetingId = interaction.options.getString('meeting-id');
			let meeting = null;

			if (meetingId) {
				meeting = await meetingsDb.getMeeting(meetingId);
			} else {
				// Try to find the meeting by the voice channel the user is currently in
				const voiceChannelId = member.voice.channelId;
				if (voiceChannelId) {
					const meetings = await callMotherboard('GET', '/api/meetings', 'discord_bot');
					const matched = meetings.find(m => m.temp_channel_id === voiceChannelId);
					if (matched) {
						meeting = {
							...matched,
							scheduled_time: matched.scheduled_time,
							attendees: (matched.attendees || []).map(a => ({
								type: a.attendee_type,
								discordId: a.discord_id
							}))
						};
					}
				}
			}

			if (!meeting) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Could not identify the meeting to start. Please provide a meeting ID or join the meeting voice channel.`
				});
			}

			if (meeting.status === 'completed' || meeting.status === 'cancelled') {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} The meeting "**${meeting.title}**" has already been completed or cancelled.`
				});
			}

			// Update status to active on Motherboard
			if (meeting.status !== 'active') {
				const response = await callMotherboard('POST', `/api/meetings/${meeting.id}/start`, 'discord_bot');
				meeting = {
					...response,
					scheduled_time: response.scheduled_time,
					attendees: (response.attendees || []).map(a => ({
						type: a.attendee_type,
						discordId: a.discord_id
					}))
				};
			}

			// Send commencement notification to events channel
			await sendCommencementNotification(interaction.guild, meeting);

			// Start recording if voice meeting and recording is enabled
			let vcChannel = null;
			if (meeting.location_type === 'discord_vc' && meeting.temp_channel_id) {
				vcChannel = interaction.guild.channels.cache.get(meeting.temp_channel_id) || await interaction.guild.channels.fetch(meeting.temp_channel_id).catch(() => null);
				if (vcChannel && process.env.RECORDING_ENABLED === 'true') {
					const { isRecording, startRecording } = require('../lib/voiceRecorder');
					if (!isRecording(meeting.id)) {
						await startRecording(vcChannel, meeting.id, interaction.client).catch(err => {
							console.error(`[MEET-START] Failed to start recording:`, err.message);
						});
					}
				}
			}

			// Send DMs to missing attendees (those not currently in the Voice Channel)
			const currentInVc = vcChannel ? new Set(vcChannel.members.keys()) : new Set();
			const attendeeIds = await resolveAttendeeUserIds(interaction.guild, meeting.attendees);
			// Include creator
			attendeeIds.add(meeting.creator_id);

			const vcLink = vcChannel ? `https://discord.com/channels/${interaction.guild.id}/${vcChannel.id}` : '';
			let pingCount = 0;

			for (const userId of attendeeIds) {
				if (!currentInVc.has(userId)) {
					try {
						const attendeeMember = await interaction.guild.members.fetch(userId).catch(() => null);
						if (attendeeMember && !attendeeMember.user.bot) {
							const dmEmbed = new EmbedBuilder()
								.setTitle(`🚨 MEETING_START_ALERT // JOIN_NOW`)
								.setDescription(`The meeting "**${meeting.title}**" has been started manually. You are expected to join.`)
								.setColor(config.COLORS.primary)
								.setTimestamp()
								.setFooter({ text: config.BRANDING.footerText });

							if (meeting.meet_code) {
								dmEmbed.addFields({ name: '🔗 MEETING LINK', value: `https://cal.gobitsnbytes.org/m/${meeting.meet_code}`, inline: false });
							} else if (vcLink) {
								dmEmbed.addFields({ name: '🔊 JOIN VOICE CHANNEL', value: `[Click here to connect](${vcLink})`, inline: false });
							}

							await attendeeMember.send({ embeds: [dmEmbed] }).catch(() => {});
							pingCount++;
						}
					} catch (dmErr) {
						console.warn(`[MEET-START] Could not send DM to user ${userId}:`, dmErr.message);
					}
				}
			}

			await interaction.editReply({
				content: `✅ Meeting "**${meeting.title}**" (ID: \`${meeting.id}\`) started successfully. Notified ${pingCount} missing attendees.`
			});

		} catch (error) {
			console.error('[MEET-START-ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to start meeting.`
			});
		}
	},

	async autocomplete(interaction) {
		try {
			const { callMotherboard } = require('../lib/motherboardApi');
			const meetings = await callMotherboard('GET', '/api/meetings', 'discord_bot');
			const choices = meetings
				.filter(m => m.status === 'scheduled' || m.status === 'pending')
				.map(m => {
					const timeStr = new Date(m.scheduled_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
					return {
						name: `${m.title.substring(0, 50)} (${timeStr})`,
						value: m.id
					};
				});

			const focusedValue = interaction.options.getFocused() || '';
			const filtered = choices.filter(choice => 
				choice.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
				choice.value.includes(focusedValue)
			);

			await interaction.respond(filtered.slice(0, 25)).catch(() => {});
		} catch (err) {
			console.error('[MEET-START-AUTOCOMPLETE-ERROR]', err);
		}
	}
};
