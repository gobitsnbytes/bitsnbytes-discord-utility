/**
 * 🔄 Transcription Pipeline — Orchestrates post-meeting processing
 * Part of the Bits&Bytes Meeting Transcript Agent
 * 
 * Pipeline: stopRecording → mergeAudio → transcribe → storeInDb → dmAttendees → deleteAudio
 * Uses a sequential FIFO queue to keep memory usage safe on 512MB VPS.
 */

const fs = require('fs');
const path = require('path');
const meetingsDb = require('./meetingsDb');
const config = require('../config');

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
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		console.error(`[PIPELINE] Timeout: meeting ${meetingId} exceeded ${timeoutMs / 1000}s processing limit`);
	}, timeoutMs);

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

		// Step 1: Merge audio segments
		console.log(`[PIPELINE] Step 1/5: Merging audio for meeting ${meetingId}...`);
		const { mergeAudioSegments } = require('./audioProcessor');
		const { mergedFilePath, durationSeconds } = await mergeAudioSegments(
			recordingData.segments,
			meetingDir,
			recordingData.startTime
		);

		if (timedOut) throw new Error('Pipeline timed out during audio merge');

		// Step 2: Transcribe via Gemini
		console.log(`[PIPELINE] Step 2/5: Transcribing via Gemini for meeting ${meetingId}...`);
		const { transcribeMeeting } = require('./transcriber');
		const speakersArray = [];
		if (recordingData.speakers) {
			for (const [userId, displayName] of recordingData.speakers) {
				speakersArray.push({ userId, displayName });
			}
		}

		const transcriptData = await transcribeMeeting(mergedFilePath, {
			title: meeting.title,
			scheduledTime: meeting.scheduled_time,
			durationSeconds,
			speakers: speakersArray,
			vcTextMessages: recordingData.textMessages || [],
		});

		if (timedOut) throw new Error('Pipeline timed out during transcription');

		// Step 3: Store in database
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

		// Dynamic participant mapping: Add actual speakers and creator to meeting_attendees in SQLite so they can access the transcript
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
				}, client);
				console.log(`[PIPELINE] Delivery results: ${deliveryResult.sent} sent, ${deliveryResult.failed} failed`);
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

		// Step 5: Cleanup — ALWAYS delete audio files, even on error
		console.log(`[PIPELINE] Step 5/5: Cleaning up audio files for meeting ${meetingId}...`);
		try {
			if (meetingDir && fs.existsSync(meetingDir)) {
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
