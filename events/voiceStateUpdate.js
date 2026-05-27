const { Events } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');

module.exports = {
	name: Events.VoiceStateUpdate,
	async execute(oldState, newState) {
		const oldChannelId = oldState.channelId;
		const newChannelId = newState.channelId;

		// ── User joined a voice channel ──
		if (newChannelId && newChannelId !== oldChannelId) {
			try {
				if (process.env.RECORDING_ENABLED === 'true') {
					const { isRecording, getMeetingIdByChannel, handleUserJoin } = require('../lib/voiceRecorder');
					const meetingId = getMeetingIdByChannel(newChannelId);
					if (meetingId && !newState.member?.user?.bot) {
						handleUserJoin(meetingId, newState.member);
					}
				}
				
				// Handle auto-commencement when 2+ humans are present
				const meeting = await meetingsDb.findMeetingByTempChannel(newChannelId);
				if (meeting && (meeting.status === 'scheduled' || meeting.status === 'pending')) {
					const newChannel = newState.channel;
					if (newChannel) {
						const humanMembers = newChannel.members.filter(m => !m.user.bot);
						if (humanMembers.size >= 2) {
							// Transition status to active
							await meetingsDb.updateMeetingStatus(meeting.id, 'active');
							meeting.status = 'active';

							// Send commencement notification
							const { sendCommencementNotification } = require('../lib/meetingsHelper');
							await sendCommencementNotification(newState.guild, meeting);
							console.log(`[MEETING] Meeting "${meeting.title}" (${meeting.id}) auto-commenced because 2+ human users joined the VC.`);
						}
					}
				}
			} catch (err) {
				console.error('[MEETING] Error handling voice join for recording / auto-commencement:', err.message);
			}
		}

		// ── User left a voice channel ──
		if (oldChannelId && oldChannelId !== newChannelId) {
			const oldChannel = oldState.channel;
			if (!oldChannel) return;

			// Notify recorder of user leave
			try {
				if (process.env.RECORDING_ENABLED === 'true') {
					const { isRecording, getMeetingIdByChannel, handleUserLeave } = require('../lib/voiceRecorder');
					const meetingId = getMeetingIdByChannel(oldChannelId);
					if (meetingId && !oldState.member?.user?.bot) {
						handleUserLeave(meetingId, oldState.member);
					}
				}
			} catch (err) {
				console.error('[MEETING] Error handling voice leave for recording:', err.message);
			}

			// If the voice channel is now empty (no non-bot members)
			const humanMembers = oldChannel.members.filter(m => !m.user.bot);
			if (humanMembers.size === 0) {
				try {
					const meeting = await meetingsDb.findMeetingByTempChannel(oldChannelId);

					if (meeting) {
						// Only end the meeting if it has actually commenced (status is active)
						// AND we are past a 5-minute grace period from the scheduled start time.
						// Otherwise, keep the VC open for attendees to join/rejoin.
						if (meeting.status === 'active') {
							const timeSinceStart = Date.now() - meeting.scheduled_time;
							if (timeSinceStart < 5 * 60 * 1000) {
								console.log(`[MEETING] Temporary VC ${oldChannel.name} (${oldChannelId}) is empty, but within 5-minute grace period. Keeping VC open.`);
								return;
							}
						} else {
							// If the meeting is still scheduled/pending, do not delete the channel when empty
							console.log(`[MEETING] Temporary VC ${oldChannel.name} (${oldChannelId}) is empty, but meeting is still scheduled/pending. Keeping VC open.`);
							return;
						}

						console.log(`[MEETING] Temporary VC ${oldChannel.name} (${oldChannelId}) is now empty.`);

						// Stop recording and queue transcription BEFORE deleting the channel
						if (process.env.RECORDING_ENABLED === 'true') {
							try {
								const { stopRecording } = require('../lib/voiceRecorder');
								const { queueTranscription } = require('../lib/transcriptionPipeline');
								const recordingData = await stopRecording(meeting.id);
								if (recordingData) {
									queueTranscription(meeting, recordingData, oldState.client).catch(err => {
										console.error(`[MEETING] Transcription pipeline error for ${meeting.id}:`, err);
									});
								}
							} catch (recErr) {
								console.error(`[MEETING] Error stopping recording for ${meeting.id}:`, recErr);
							}
						}

						// Delete the temp VC
						await oldChannel.delete('Temporary meeting VC has ended (all users left).').catch(err => {
							console.error(`[MEETING ERROR] Failed to delete temporary VC:`, err.message);
						});

						// Mark meeting as completed
						await meetingsDb.updateMeetingStatus(meeting.id, 'completed');
						console.log(`[MEETING] Meeting "${meeting.title}" (${meeting.id}) marked as completed.`);
					}
				} catch (error) {
					console.error('[MEETING ERROR] Error checking temporary VC status:', error);
				}
			}
		}
	}
};
