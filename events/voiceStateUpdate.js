const { Events } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');

// Map of channelId -> timeoutInstance for empty VC cleanup
const activeCleanupTimeouts = new Map();

module.exports = {
	name: Events.VoiceStateUpdate,
	async execute(oldState, newState) {
		const oldChannelId = oldState.channelId;
		const newChannelId = newState.channelId;

		// ── User joined a voice channel ──
		if (newChannelId && newChannelId !== oldChannelId) {
			try {
				// Cancel any pending cleanup timeout for this channel
				if (activeCleanupTimeouts.has(newChannelId)) {
					console.log(`[MEETING] User joined VC. Cancelling pending cleanup timeout for channel ${newChannelId}.`);
					clearTimeout(activeCleanupTimeouts.get(newChannelId));
					activeCleanupTimeouts.delete(newChannelId);
				}

				const meeting = await meetingsDb.findMeetingByTempChannel(newChannelId);
				if (meeting) {
					// Resolve the voice channel robustly to handle caching race conditions
					let voiceChannel = newState.channel;
					if (!voiceChannel) {
						voiceChannel = await newState.guild.channels.fetch(newChannelId).catch(() => null);
					}

					if (!voiceChannel) {
						console.warn(`[MEETING] Could not resolve voice channel ${newChannelId} for meeting ${meeting.id}`);
						return;
					}

					// 1. Handle auto-commencement when 2+ humans are present
					if (meeting.status === 'scheduled' || meeting.status === 'pending') {
						const humanMembers = voiceChannel.members.filter(m => !m.user.bot);
						if (humanMembers.size >= 2) {
							// Transition status to active atomically
							if (await meetingsDb.tryClaimReminder(meeting.id, 'commencement')) {
								await meetingsDb.updateMeetingStatus(meeting.id, 'active');
								meeting.status = 'active';

								// Send commencement notification
								const { sendCommencementNotification } = require('../lib/meetingsHelper');
								await sendCommencementNotification(newState.guild, meeting);
								console.log(`[MEETING] Meeting "${meeting.title}" (${meeting.id}) auto-commenced because 2+ human users joined the VC.`);
							}
						}
					}

					// 2. Start / Resume recording on-demand if meeting is active
					if (meeting.status === 'active' && process.env.RECORDING_ENABLED === 'true') {
						const { isRecording, startRecording, handleUserJoin } = require('../lib/voiceRecorder');
						if (!isRecording(meeting.id)) {
							console.log(`[MEETING] Starting recording on-demand for active meeting "${meeting.title}" (${meeting.id}) because human joined.`);
							await startRecording(voiceChannel, meeting.id, newState.client).catch(err => {
								console.error(`[MEETING] Failed to start recording on-demand:`, err.message);
							});
						} else if (!newState.member?.user?.bot) {
							await handleUserJoin(meeting.id, newState.member);
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
						await handleUserLeave(meetingId, oldState.member);
					}
				}
			} catch (err) {
				console.error('[MEETING] Error handling voice leave for recording:', err.message);
			}

			// If the voice channel is now empty (no non-bot members)
			const humanMembers = oldChannel.members.filter(m => !m.user.bot);
			if (humanMembers.size === 0) {
				// Cancel any existing timeout just in case
				if (activeCleanupTimeouts.has(oldChannelId)) {
					clearTimeout(activeCleanupTimeouts.get(oldChannelId));
					activeCleanupTimeouts.delete(oldChannelId);
				}

				// Fetch meeting to calculate dynamic cleanup delay
				// (Channel must be empty for at least 2 minutes AND past the 5-minute meeting grace period)
				let cleanupDelay = 2 * 60 * 1000;
				try {
					const meeting = await meetingsDb.findMeetingByTempChannel(oldChannelId);
					if (meeting && meeting.status === 'active') {
						const startTime = meeting.activated_at || meeting.scheduled_time;
						const gracePeriodRemaining = (startTime + 5 * 60 * 1000) - Date.now();
						cleanupDelay = Math.max(cleanupDelay, gracePeriodRemaining);
					}
				} catch (err) {
					console.error('[MEETING] Error calculating dynamic VC cleanup delay:', err.message);
				}

				const timeout = setTimeout(async () => {
					activeCleanupTimeouts.delete(oldChannelId);
					try {
						// Re-fetch channel to verify empty status dynamically
						const channel = oldState.guild.channels.cache.get(oldChannelId) || await oldState.guild.channels.fetch(oldChannelId).catch(() => null);
						if (!channel) return; // Channel already deleted

						const currentHumans = channel.members.filter(m => !m.user.bot);
						if (currentHumans.size > 0) {
							console.log(`[MEETING] VC "${channel.name}" (${oldChannelId}) is no longer empty. Skipping cleanup.`);
							return;
						}

						const meeting = await meetingsDb.findMeetingByTempChannel(oldChannelId);

						if (meeting) {
							// Only end the meeting if it has actually commenced (status is active)
							// AND we are past a 5-minute grace period from the scheduled start time.
							// Otherwise, keep the VC open for attendees to join/rejoin.
							if (meeting.status === 'active') {
								const startTime = meeting.activated_at || meeting.scheduled_time;
								const timeSinceStart = Date.now() - startTime;
								if (timeSinceStart < 5 * 60 * 1000) {
									console.log(`[MEETING] Temporary VC ${channel.name} (${oldChannelId}) is empty, but within 5-minute grace period. Keeping VC open.`);
									return;
								}
							} else {
								// If the meeting is still scheduled/pending, do not delete the channel when empty
								console.log(`[MEETING] Temporary VC ${channel.name} (${oldChannelId}) is empty, but meeting is still scheduled/pending. Keeping VC open.`);
								return;
							}

							console.log(`[MEETING] Temporary VC ${channel.name} (${oldChannelId}) has met cleanup criteria after ${Math.round(cleanupDelay / 1000)}s. Initiating cleanup...`);

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
							await channel.delete('Temporary meeting VC has ended (empty for 2 minutes).').catch(err => {
								console.error(`[MEETING ERROR] Failed to delete temporary VC:`, err.message);
							});

							// Mark meeting as completed
							await meetingsDb.updateMeetingStatus(meeting.id, 'completed');
							console.log(`[MEETING] Meeting "${meeting.title}" (${meeting.id}) marked as completed.`);
						}
					} catch (error) {
						console.error('[MEETING ERROR] Error during debounced VC cleanup:', error);
					}
				}, cleanupDelay);

				activeCleanupTimeouts.set(oldChannelId, timeout);
				console.log(`[MEETING] Temporary VC ${oldChannel.name} (${oldChannelId}) is now empty. Cleanup scheduled in ${Math.round(cleanupDelay / 1000)} seconds.`);
			}
		}
	}
};
