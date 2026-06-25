/**
 * 🔄 Transcription Pipeline — Orchestrates post-meeting processing
 * Part of the Bits&Bytes Meeting Transcript Agent
 * 
 * Pipeline: stopRecording → mergeAudio → transcribe → storeInDb → dmAttendees → deleteAudio
 * Uses a sequential FIFO queue to keep memory usage safe on 512MB VPS.
 */

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const meetingsDb = require('./meetingsDb');
const config = require('../config');

async function resolveAssigneeDiscordId(assigneeName, speakersMap, fullMeeting, guild) {
	if (!assigneeName) return null;
	
	const cleanName = assigneeName.trim().toLowerCase();
	
	// 1. Check speakersMap (which maps string discordId -> string displayName)
	if (speakersMap) {
		for (const [userId, displayName] of speakersMap.entries()) {
			if (displayName.trim().toLowerCase() === cleanName) {
				return userId;
			}
		}
	}
	
	// 2. Check fullMeeting attendees display names in guild cache/fetch
	if (fullMeeting && fullMeeting.attendees && guild) {
		for (const att of fullMeeting.attendees) {
			if (att.type === 'user') {
				const member = guild.members.cache.get(att.discordId) || await guild.members.fetch(att.discordId).catch(() => null);
				if (member) {
					if (member.displayName.trim().toLowerCase() === cleanName ||
						member.user.username.trim().toLowerCase() === cleanName) {
						return att.discordId;
					}
				}
			}
		}
	}
	
	// 3. Fallback: Search the entire guild cache/fetch for a match
	if (guild) {
		const member = guild.members.cache.find(m => 
			m.displayName.toLowerCase() === cleanName || 
			m.user.username.toLowerCase() === cleanName
		);
		if (member) return member.id;
	}
	
	return null;
}

async function sendActionItemDM(client, guild, discordId, actionItemId, item, meeting) {
	try {
		const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
		if (!member || member.user.bot) return;
		
		const embed = new EmbedBuilder()
			.setTitle(`📋 ACTION_ITEM_ASSIGNED`)
			.setDescription(`You have been assigned a new task from the meeting "**${meeting.title}**".`)
			.addFields(
				{ name: '📝 TASK', value: item.task },
				{ name: '📅 DEADLINE', value: item.deadline || 'None specified', inline: true },
				{ name: '👥 ASSIGNEE', value: item.assignee, inline: true }
			)
			.setColor(config.COLORS.primary)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });
			
		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`action_item_complete_${actionItemId}`)
				.setLabel('Mark Completed')
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`action_item_dismiss_${actionItemId}`)
				.setLabel('Dismiss')
				.setStyle(ButtonStyle.Secondary)
		);
		
		await member.send({ embeds: [embed], components: [row] });
	} catch (err) {
		console.warn(`[PIPELINE] Failed to send Action Item DM to user ${discordId}:`, err.message);
	}
}

// Sequential processing queue
const queue = [];
let processing = false;

/**
 * Queue a meeting for transcription processing.
 * Runs sequentially — only one transcription at a time to keep memory safe.
 * 
 * @param {Object} meeting - Meeting object from DB
 * @param {Object} recordingData - Recording data from voiceRecorder.stopRecording()
 * @param {Object} recordingData.segments - Per-user recording segments
 * @param {Map} recordingData.speakers - Map of userId → displayName
 * @param {Array} recordingData.textMessages - VC text chat messages
 * @param {number} recordingData.startTime - Recording start timestamp
 * @param {number} recordingData.endTime - Recording end timestamp
 * @param {string} recordingData.meetingDir - Temp directory with audio files
 * @param {import('discord.js').Client} client - Discord client
 */
async function queueTranscription(meeting, recordingData, client) {
	queue.push({ meeting, recordingData, client });
	console.log(`[PIPELINE] Queued meeting "${meeting.title}" (${meeting.id}) for transcription. Queue size: ${queue.length}`);

	if (!processing) {
		processNext();
	}
}

/**
 * Process the next item in the queue.
 */
async function processNext() {
	if (queue.length === 0) {
		processing = false;
		return;
	}

	processing = true;
	const { meeting, recordingData, client } = queue.shift();
	const meetingId = meeting.id;
	const meetingDir = recordingData.meetingDir;

	console.log(`[PIPELINE] Processing meeting "${meeting.title}" (${meetingId}). Remaining in queue: ${queue.length}`);

	// Timeout guard
	const timeoutMs = config.RECORDING?.postProcessingTimeoutMs || 5 * 60 * 1000;
	const pipelineStartTime = Date.now();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		console.error(`[PIPELINE] Timeout: meeting ${meetingId} exceeded ${timeoutMs / 1000}s processing limit`);
	}, timeoutMs);

	const withTimeout = (promise, stepName) => {
		const elapsedTime = Date.now() - pipelineStartTime;
		const remainingTime = timeoutMs - elapsedTime;
		if (remainingTime <= 0) {
			return Promise.reject(new Error(`Pipeline timed out before ${stepName}`));
		}
		return Promise.race([
			promise,
			new Promise((_, reject) => setTimeout(() => reject(new Error(`Pipeline timed out during ${stepName}`)), remainingTime))
		]);
	};

	try {
		// Step 0: Check minimum duration
		const durationMs = (recordingData.endTime || Date.now()) - (recordingData.startTime || Date.now());
		const minDuration = config.RECORDING?.minMeetingDurationMs || 60000;

		if (durationMs < minDuration) {
			console.log(`[PIPELINE] Meeting "${meeting.title}" was only ${Math.round(durationMs / 1000)}s — skipping transcription (minimum: ${minDuration / 1000}s)`);
			await meetingsDb.updateRecordingStatus(meetingId, 'skipped').catch(() => {});
			return;
		}

		await meetingsDb.updateRecordingStatus(meetingId, 'processing');

		// Step 1: Merge audio segments (remote)
		console.log(`[PIPELINE] Step 1/5: Merging audio for meeting ${meetingId}...`);
		const { mergeAudioSegmentsRemote } = require('./audioProcessor');
		
		let remoteMergeError = null;
		let mergedFilePath, durationSeconds, segmentObjectNames;
		
		try {
			const result = await Promise.race([
				mergeAudioSegmentsRemote(
					recordingData.segments,
					meetingDir,
					recordingData.startTime,
					meetingId
				),
				new Promise((_, reject) => setTimeout(() => reject(new Error('Remote audio merge timed out (40 minutes limit)')), 40 * 60 * 1000))
			]);
			mergedFilePath = result.mergedFilePath;
			durationSeconds = result.durationSeconds;
			segmentObjectNames = result.segmentObjectNames;
		} catch (err) {
			remoteMergeError = err;
			
			// Post a failure notification to the log channel
			const logger = require('./logger');
			logger.error(`❌ Remote FFmpeg merge dispatch failed for meeting "${meeting.title}" (${meetingId})`, err);
			
			throw err;
		}

		if (timedOut) throw new Error('Pipeline timed out during remote audio merge');

		// Step 2: Transcribe via Motherboard API
		console.log(`[PIPELINE] Step 2/5: Transcribing via Motherboard API for meeting ${meetingId}...`);
		const { callMotherboard } = require('./motherboardApi');
		const speakersArray = [];
		if (recordingData.speakers) {
			for (const [userId, displayName] of recordingData.speakers) {
				speakersArray.push({ userId, displayName });
			}
		}

		const response = await withTimeout(
			callMotherboard(
				'POST',
				`/api/meetings/${meetingId}/transcribe`,
				meeting.creator_id || 'discord_bot',
				{
					durationSeconds,
					speakers: speakersArray,
					vcTextMessages: recordingData.textMessages || [],
					startTime: recordingData.startTime,
					speakingTimeline: recordingData.speakingTimeline || [],
				},
				{ file: mergedFilePath }
			),
			'transcription'
		);

		if (timedOut) throw new Error('Pipeline timed out during transcription');

		// Step 3: Parse and store transcript
		const transcriptData = {
			summary: response.summary,
			keyDecisions: response.key_decisions ? JSON.parse(response.key_decisions) : [],
			actionItems: response.action_items ? JSON.parse(response.action_items) : [],
			fullTranscript: response.full_transcript,
			timestampedTranscript: response.timestamped_transcript
		};

		console.log(`[PIPELINE] Step 3/5: Storing transcript for meeting ${meetingId}...`);
		await meetingsDb.saveTranscript(meetingId, {
			summary: transcriptData.summary,
			keyDecisions: transcriptData.keyDecisions,
			actionItems: transcriptData.actionItems,
			fullTranscript: transcriptData.fullTranscript,
			timestampedTranscript: transcriptData.timestampedTranscript,
			vcTextMessages: recordingData.textMessages || [],
			durationSeconds,
			speakerCount: speakersArray.length,
		});

		// Dynamic participant mapping: Add actual speakers and creator to meeting_attendees
		if (meeting.creator_id) {
			await meetingsDb.addAttendee(meetingId, 'user', meeting.creator_id).catch(() => {});
		}
		if (recordingData.speakers) {
			for (const userId of recordingData.speakers.keys()) {
				if (userId !== client.user.id) {
					await meetingsDb.addAttendee(meetingId, 'user', userId).catch(() => {});
				}
			}
		}

		await meetingsDb.updateRecordingStatus(meetingId, 'completed');

		if (timedOut) throw new Error('Pipeline timed out during DB storage');

		// Step 4: Deliver to attendees via DM
		console.log(`[PIPELINE] Step 4/5: Delivering transcript for meeting ${meetingId}...`);
		const guild = client.guilds.cache.first();
		if (guild) {
			// Re-fetch meeting with attendees for delivery
			const fullMeeting = await meetingsDb.getMeeting(meetingId);
			if (fullMeeting) {
				const { deliverTranscript } = require('./transcriptDelivery');
				const deliveryResult = await deliverTranscript(guild, fullMeeting, {
					...transcriptData,
					durationSeconds,
					speakerCount: speakersArray.length,
					// Forward raw VC chat messages and meeting start time so the
					// delivery layer can interleave them by timestamp in JS
					vcTextMessages: recordingData.textMessages || [],
					meetingStartMs: recordingData.startTime || 0,
				}, client);
				console.log(`[PIPELINE] Delivery results: ${deliveryResult.sent} sent, ${deliveryResult.failed} failed`);

				// Process and store individual action items
				if (transcriptData.actionItems && Array.isArray(transcriptData.actionItems)) {
					console.log(`[PIPELINE] Resolving and registering ${transcriptData.actionItems.length} action items...`);
					for (const item of transcriptData.actionItems) {
						try {
							const discordId = await resolveAssigneeDiscordId(
								item.assignee,
								recordingData.speakers,
								fullMeeting,
								guild
							);
							const actionItemId = await meetingsDb.createActionItem(
								meetingId,
								item.assignee,
								discordId,
								item.task,
								item.deadline
							);
							if (discordId) {
								await sendActionItemDM(client, guild, discordId, actionItemId, item, meeting);
							}
						} catch (actionErr) {
							console.error(`[PIPELINE] Error processing action item for "${item.assignee}":`, actionErr);
						}
					}
				}
			}
		} else {
			console.warn(`[PIPELINE] No guild found — cannot deliver transcript`);
		}

		console.log(`[PIPELINE] ✅ Meeting "${meeting.title}" (${meetingId}) fully processed!`);

	} catch (err) {
		console.error(`[PIPELINE] ❌ Failed to process meeting "${meeting.title}" (${meetingId}):`, err);
		await meetingsDb.updateRecordingStatus(meetingId, 'failed').catch(() => {});
	} finally {
		clearTimeout(timeout);

		// Step 5: Cleanup & Archive — Archive merged file and delete raw segments
		console.log(`[PIPELINE] Step 5/5: Archiving and cleaning up audio files for meeting ${meetingId}...`);
		try {
			if (meetingDir && fs.existsSync(meetingDir)) {
				const mergedFile = path.join(meetingDir, 'merged_meeting.ogg');
				if (fs.existsSync(mergedFile)) {
					// 1. Ensure archive folder exists
					const archiveDir = path.join(__dirname, '../data/recordings-archive');
					if (!fs.existsSync(archiveDir)) {
						fs.mkdirSync(archiveDir, { recursive: true });
					}
					
					// 2. Copy merged file to archive named as <meetingId>.ogg
					const archivePath = path.join(archiveDir, `${meetingId}.ogg`);
					fs.copyFileSync(mergedFile, archivePath);
					console.log(`[PIPELINE] Archived merged recording to: ${archivePath}`);

					// 3. Keep only the last 8 archived recordings
					const archivedFiles = fs.readdirSync(archiveDir)
						.filter(f => f.endsWith('.ogg'))
						.map(f => {
							const filePath = path.join(archiveDir, f);
							return {
								file: filePath,
								mtime: fs.statSync(filePath).mtimeMs
							};
						});
					
					if (archivedFiles.length > 8) {
						// Sort oldest first
						archivedFiles.sort((a, b) => a.mtime - b.mtime);
						const filesToDelete = archivedFiles.slice(0, archivedFiles.length - 8);
						for (const toDelete of filesToDelete) {
							try {
								fs.unlinkSync(toDelete.file);
								console.log(`[PIPELINE] Purged old archived recording: ${path.basename(toDelete.file)}`);
							} catch (err) {
								console.warn(`[PIPELINE] Failed to delete old archive file ${toDelete.file}:`, err.message);
							}
						}
					}
				}
				
				// 4. Safely delete the rest of raw segments and temp files in meetingDir
				fs.rmSync(meetingDir, { recursive: true, force: true });
				console.log(`[PIPELINE] Deleted recording directory: ${meetingDir}`);
			}
		} catch (cleanupErr) {
			console.error(`[PIPELINE] Warning: Failed to cleanup ${meetingDir}:`, cleanupErr.message);
		}

		// Process next in queue
		processNext();
	}
}

module.exports = { queueTranscription };
