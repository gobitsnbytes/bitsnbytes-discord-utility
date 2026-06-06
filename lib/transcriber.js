/**
 * 🤖 Transcriber — Gemini 3.5 Flash audio transcription via Google AI
 * Part of the Bits&Bytes Meeting Transcript Agent
 * 
 * Uploads meeting audio to Google File API, sends to Gemini for
 * multimodal transcription, and returns structured meeting notes.
 * Supports Hinglish / Hindi / English (multilingual, no translation).
 */

const { GoogleGenAI, createPartFromUri } = require('@google/genai');
const config = require('../config');

// Initialize Google GenAI client
let aiClient = null;

function getAIClient() {
	if (!aiClient) {
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) {
			throw new Error('[TRANSCRIBER] GEMINI_API_KEY is not set in environment variables');
		}
		aiClient = new GoogleGenAI({ apiKey });
	}
	return aiClient;
}

/**
 * Transcribe a meeting audio file using Gemini 3.5 Flash.
 * 
 * @param {string} audioFilePath - Path to the merged .ogg audio file
 * @param {Object} meetingContext - Context about the meeting
 * @param {string} meetingContext.title - Meeting title
 * @param {number} meetingContext.scheduledTime - Scheduled time (ms timestamp)
 * @param {number} meetingContext.durationSeconds - Meeting duration in seconds
 * @param {Array<{userId: string, displayName: string}>} meetingContext.speakers - Known speakers
 * @param {Array<{author: string, content: string, timestamp: number}>} meetingContext.vcTextMessages - VC text chat messages
 * @returns {Promise<{summary: string, keyDecisions: string[], actionItems: Array<{assignee: string, task: string, deadline?: string}>, fullTranscript: string, timestampedTranscript: string}>}
 */
async function transcribeMeeting(audioFilePath, meetingContext) {
	const ai = getAIClient();
	const primaryModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
	const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash';

	// Try primary model first, then fallback
	try {
		return await attemptTranscription(ai, primaryModel, audioFilePath, meetingContext);
	} catch (primaryErr) {
		console.warn(`[TRANSCRIBER] Primary model (${primaryModel}) failed: ${primaryErr.message}`);
		console.log(`[TRANSCRIBER] Retrying with fallback model (${fallbackModel})...`);

		try {
			return await attemptTranscription(ai, fallbackModel, audioFilePath, meetingContext);
		} catch (fallbackErr) {
			console.error(`[TRANSCRIBER] Fallback model (${fallbackModel}) also failed:`, fallbackErr.message);
			throw new Error(`Transcription failed with both models: ${primaryErr.message} | ${fallbackErr.message}`);
		}
	}
}

/**
 * Attempt transcription with a specific model, with retry logic.
 */
async function attemptTranscription(ai, model, audioFilePath, meetingContext) {
	const maxRetries = config.TRANSCRIPTION?.maxRetries || 3;
	const baseBackoff = config.TRANSCRIPTION?.retryBackoffMs || 2000;
	let lastError;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		let uploadedFile = null;

		try {
			console.log(`[TRANSCRIBER] Attempt ${attempt}/${maxRetries} with model ${model}`);

			// Step 1: Upload audio file to Google File API
			console.log(`[TRANSCRIBER] Uploading audio file...`);
			uploadedFile = await ai.files.upload({
				file: audioFilePath,
				config: { mimeType: 'audio/ogg' },
			});
			console.log(`[TRANSCRIBER] File uploaded: ${uploadedFile.name} (${uploadedFile.uri})`);

			// Step 2: Build the prompt
			const prompt = buildTranscriptionPrompt(meetingContext);

			// Step 3: Generate content with audio + prompt
			console.log(`[TRANSCRIBER] Sending to ${model} for transcription...`);
			const response = await ai.models.generateContent({
				model,
				contents: [
					createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
					prompt,
				],
			});

			const responseText = response.text;
			if (!responseText) {
				throw new Error('Empty response from Gemini');
			}

			// Step 4: Parse the structured response
			const parsed = parseTranscriptionResponse(responseText);
			console.log(`[TRANSCRIBER] ✅ Transcription successful with ${model}`);

			// Step 5: Cleanup uploaded file
			try {
				await ai.files.delete({ name: uploadedFile.name });
				console.log(`[TRANSCRIBER] Cleaned up uploaded file from Google File API`);
			} catch (cleanupErr) {
				console.warn(`[TRANSCRIBER] Could not delete uploaded file: ${cleanupErr.message}`);
			}

			return parsed;

		} catch (err) {
			lastError = err;
			console.warn(`[TRANSCRIBER] Attempt ${attempt} failed: ${err.message}`);

			// Cleanup uploaded file on error
			if (uploadedFile) {
				try {
					await ai.files.delete({ name: uploadedFile.name });
				} catch { /* ignore cleanup errors */ }
			}

			// Don't retry on non-transient errors
			if (err.message?.includes('INVALID_ARGUMENT') || err.message?.includes('NOT_FOUND')) {
				throw err;
			}

			// Exponential backoff before retry
			if (attempt < maxRetries) {
				const backoff = baseBackoff * Math.pow(2, attempt - 1);
				console.log(`[TRANSCRIBER] Waiting ${backoff}ms before retry...`);
				await sleep(backoff);
			}
		}
	}

	throw lastError;
}

/**
 * Build the transcription prompt with meeting context and multilingual support.
 * Uses deterministic non-overlapping speaker turn slots to eliminate acoustic voice matching.
 */
function buildTranscriptionPrompt(ctx) {
	const speakerList = (ctx.speakers || [])
		.map(s => s.displayName)
		.join(', ') || 'Unknown';

	const durationMin = Math.round((ctx.durationSeconds || 0) / 60);
	const durationSec = ctx.durationSeconds || 0;
	// Rough upper bound: ~150 words/minute for conversational speech
	const maxExpectedWords = Math.ceil(durationMin * 150 * (ctx.speakers?.length || 1));

	// Build deterministic non-overlapping speaker turn slots
	let speakerSlotsSection = '';
	if (ctx.speakingTimeline && ctx.speakingTimeline.length > 0) {
		const slots = buildSpeakerTurnSlots(ctx.speakingTimeline, ctx.startTime || ctx.scheduledTime || 0);
		if (slots.length > 0) {
			const slotLines = slots.map((slot, i) => {
				return `${i + 1}. [${formatMsToTimestamp(slot.startMs)}–${formatMsToTimestamp(slot.endMs)}] → ${slot.displayName}`;
			}).join('\n');

			speakerSlotsSection = `

## Deterministic Speaker Turn Table
The following table was computed from Discord's voice activity events and is **ground truth**.
Each row is a non-overlapping time window and the speaker assigned to it.
You MUST attribute every utterance to the speaker whose slot covers that timestamp.
Do NOT infer speakers from voice characteristics — use ONLY this table.

${slotLines}

If speech occurs outside all listed slots, label it as "Unknown Speaker".
If a slot contains only silence, background noise, or is inaudible, write [silence] or [inaudible] — do NOT fabricate speech.`;
		}
	}

	let vcChatSection = '';
	if (ctx.vcTextMessages && ctx.vcTextMessages.length > 0) {
		// NOTE: VC text messages are NOT passed to Gemini for 'weaving' because the LLM
		// cannot reliably interleave them at correct timestamps — it always appends them
		// at the end. We handle interleaving ourselves in JS after transcription (see
		// transcriptDelivery.js buildTranscriptText / mergeTextMessagesIntoTranscript).
		// vcChatSection is intentionally left empty here.
	}

	return `You are a professional meeting transcriber and note-taker for the Bits&Bytes team.

## Meeting Information
- **Title**: ${ctx.title || 'Untitled Meeting'}
- **Duration**: ${durationMin} minute${durationMin !== 1 ? 's' : ''} (${durationSec} seconds)
- **Known Participants**: ${speakerList}${speakerSlotsSection}

## Your Task
Transcribe the audio recording of this meeting. The participants may speak in:
- **English**
- **Hindi** (हिन्दी)
- **Hinglish** (a natural mix of Hindi and English, very common in Indian workplaces)

## MANDATORY ANTI-HALLUCINATION RULES — FOLLOW THESE EXACTLY:
1. **Do NOT fabricate or guess words.** If speech is unclear or inaudible, write [inaudible] at that point. Never substitute with plausible-sounding words.
2. **Do NOT add content beyond what is actually spoken.** The recording is ${durationMin} minutes long. Your transcript must not imply significantly more speech than could occur in ${durationMin} minutes (~${maxExpectedWords} words maximum across all speakers).
3. **Do NOT transcribe background noise, music, microphone rustling, or the consent announcement audio** played at the start of the recording. Skip those and begin from actual meeting speech.
4. **Do NOT invent participants, decisions, or action items** that were not explicitly mentioned.
5. **Silence and gaps are normal** — do not fill them with fabricated dialogue.

## Speaker Attribution Rules:
6. **Use the "Deterministic Speaker Turn Table" above as the ONLY source for who is speaking at any timestamp.** Do not try to distinguish voices acoustically.
7. **Do NOT translate.** If someone says "yaar ye feature toh bahut important hai", write it exactly as spoken in Hinglish — do NOT convert to English.
8. **Timestamps**: Provide timestamps in [MM:SS] format relative to the start of the recording.
9. **Summary and action items**: Write these in English for consistency, even if the meeting was in Hindi/Hinglish.

## Required Output Format
Respond with ONLY a valid JSON object (no markdown code blocks, no extra text) with these exact fields:

{
  "summary": "A clear 3-5 sentence summary of the meeting in English",
  "keyDecisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {"assignee": "Person Name", "task": "What they need to do", "deadline": "By when (if mentioned)"}
  ],
  "fullTranscript": "Speaker-labeled transcript with paragraphs. Use the speaker's name followed by a colon. Use [inaudible] for unclear speech.",
  "timestampedTranscript": "[00:00] Speaker: What they said\\n[00:15] Another Speaker: Their response\\n..."
}

If no decisions or action items were discussed, use empty arrays [].
If you cannot determine a deadline for an action item, omit the deadline field.`;
}

/**
 * Parse the transcription response from Gemini.
 * Handles JSON parsing with fallbacks for common LLM output quirks.
 */
function parseTranscriptionResponse(responseText) {
	let text = responseText.trim();

	// Strip markdown code block wrappers if present
	if (text.startsWith('```json')) {
		text = text.slice(7);
	} else if (text.startsWith('```')) {
		text = text.slice(3);
	}
	if (text.endsWith('```')) {
		text = text.slice(0, -3);
	}
	text = text.trim();

	try {
		const parsed = JSON.parse(text);

		// Validate required fields
		return {
			summary: parsed.summary || 'No summary available.',
			keyDecisions: Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions : [],
			actionItems: Array.isArray(parsed.actionItems)
				? parsed.actionItems.map(item => ({
					assignee: item.assignee || 'Unassigned',
					task: item.task || '',
					...(item.deadline ? { deadline: item.deadline } : {}),
				}))
				: [],
			fullTranscript: parsed.fullTranscript || '',
			timestampedTranscript: parsed.timestampedTranscript || '',
		};
	} catch (parseErr) {
		console.warn(`[TRANSCRIBER] Failed to parse JSON response, extracting manually...`);

		// Fallback: treat the whole response as a transcript
		return {
			summary: 'Meeting transcript was generated but could not be parsed into structured format.',
			keyDecisions: [],
			actionItems: [],
			fullTranscript: responseText,
			timestampedTranscript: '',
		};
	}
}

/**
 * Simple sleep utility.
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format milliseconds into [MM:SS] format relative to meeting start.
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted timestamp string, e.g. "01:23"
 */
function formatMsToTimestamp(ms) {
	const totalSeconds = Math.round(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Builds non-overlapping, interleaved speaker turn slots from raw voice activity events.
 * Similar to RTTM diarization output — each slot has exactly one speaker assigned,
 * making it directly usable by the LLM without any acoustic voice-matching guesswork.
 *
 * Algorithm:
 *  1. Filter out sub-500ms noise bursts.
 *  2. Convert all events to relative milliseconds from session start.
 *  3. Sort all events across all users by start time.
 *  4. Walk the sorted list: when speakers overlap, assign the overlapping window
 *     to whoever started speaking first ("first-in wins"). Short gaps (≤800ms)
 *     between the same speaker are merged to avoid choppy slot tables.
 *  5. Return the final non-overlapping slot list sorted by start time.
 *
 * @param {Array<{userId: string, displayName: string, startTime: number, endTime: number}>} timeline
 * @param {number} sessionStartTime
 * @returns {Array<{displayName: string, startMs: number, endMs: number}>}
 */
function buildSpeakerTurnSlots(timeline, sessionStartTime) {
	if (!timeline || timeline.length === 0) return [];

	// 1. Filter noise and convert to relative ms
	const events = timeline
		.filter(e => (e.endTime - e.startTime) >= 500)
		.map(e => ({
			displayName: e.displayName,
			userId: e.userId,
			startMs: Math.max(0, e.startTime - sessionStartTime),
			endMs: Math.max(0, e.endTime - sessionStartTime),
		}))
		.filter(e => e.endMs > e.startMs);

	if (events.length === 0) return [];

	// 2. Sort all events by start time
	events.sort((a, b) => a.startMs - b.startMs);

	// 3. Build non-overlapping slots using a sweep-line approach
	// Each slot: { displayName, startMs, endMs }
	const slots = [];
	let cursor = 0; // current time position in the sweep

	for (const evt of events) {
		const start = Math.max(evt.startMs, cursor);
		const end = evt.endMs;

		if (end <= start) continue; // fully overlapped by a prior event, skip

		// If the last slot is the same speaker and gap is small, merge
		const last = slots[slots.length - 1];
		if (last && last.displayName === evt.displayName && (start - last.endMs) <= 800) {
			last.endMs = Math.max(last.endMs, end);
		} else {
			slots.push({ displayName: evt.displayName, startMs: start, endMs: end });
		}

		cursor = Math.max(cursor, end);
	}

	return slots;
}

/**
 * Legacy coalesceTimeline — kept for backward compatibility and export.
 * Now delegates to buildSpeakerTurnSlots for the same non-overlapping output.
 *
 * @param {Array<{userId: string, displayName: string, startTime: number, endTime: number}>} timeline
 * @param {number} sessionStartTime
 * @returns {Array<{displayName: string, startMs: number, endMs: number}>}
 */
function coalesceTimeline(timeline, sessionStartTime) {
	return buildSpeakerTurnSlots(timeline, sessionStartTime);
}

module.exports = {
	transcribeMeeting,
	coalesceTimeline,
	formatMsToTimestamp,
};
