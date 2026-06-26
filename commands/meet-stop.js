const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');
const { isStaff, getForkLeadRole } = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('meet-stop')
		.setDescription('Manually stop an active meeting, delete its voice channel, and queue transcription.')
		.addStringOption(option => 
			option.setName('meeting-id')
				.setDescription('The ID of the meeting to stop (optional if you are in the meeting VC)')
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
				.setDescription('Your credentials do not grant access to stop meetings.')
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
					content: `${config.EMOJIS.error} Could not identify the meeting to stop. Please provide a meeting ID or join the meeting voice channel.`
				});
			}

			if (meeting.status !== 'active') {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} The meeting "**${meeting.title}**" is not currently active (status: ${meeting.status}).`
				});
			}

			console.log(`[MEET-STOP] Manually stopping meeting "${meeting.title}" (${meeting.id}) triggered by ${interaction.user.tag}`);

			// 1. Stop recording and queue transcription
			let hasRecording = false;
			if (process.env.RECORDING_ENABLED === 'true') {
				try {
					const { stopRecording } = require('../lib/voiceRecorder');
					const { queueTranscription } = require('../lib/transcriptionPipeline');
					const recordingData = await stopRecording(meeting.id);
					if (recordingData) {
						hasRecording = true;
						queueTranscription(meeting, recordingData, interaction.client).catch(err => {
							console.error(`[MEET-STOP] Transcription pipeline error for ${meeting.id}:`, err);
						});
					}
				} catch (recErr) {
					console.error(`[MEET-STOP] Error stopping recording:`, recErr.message);
				}
			}

			// 2. Delete the temporary voice channel if it exists
			let channelDeleted = false;
			if (meeting.temp_channel_id) {
				try {
					const channel = interaction.guild.channels.cache.get(meeting.temp_channel_id) || 
									await interaction.guild.channels.fetch(meeting.temp_channel_id).catch(() => null);
					if (channel) {
						await channel.delete('Temporary VC manually stopped.').catch(() => {});
						channelDeleted = true;
					}
				} catch (chanErr) {
					console.warn(`[MEET-STOP] Could not delete VC channel:`, chanErr.message);
				}
			}

			// 3. Mark meeting as completed on Motherboard
			await callMotherboard('POST', `/api/meetings/${meeting.id}/stop`, 'discord_bot');

			let successMessage = `✅ Meeting "**${meeting.title}**" has been stopped successfully.`;
			if (hasRecording) {
				successMessage += `\n🎙️ Recording stopped and transcription has been queued.`;
			}
			if (channelDeleted) {
				successMessage += `\n🔊 Temporary voice channel was cleaned up.`;
			}

			await interaction.editReply({
				content: successMessage
			});

		} catch (error) {
			console.error('[MEET-STOP-ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to stop meeting.`
			});
		}
	},

	async autocomplete(interaction) {
		try {
			const { callMotherboard } = require('../lib/motherboardApi');
			const meetings = await callMotherboard('GET', '/api/meetings', 'discord_bot');
			const choices = meetings
				.filter(m => m.status === 'active')
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
			console.error('[MEET-STOP-AUTOCOMPLETE-ERROR]', err);
		}
	}
};
