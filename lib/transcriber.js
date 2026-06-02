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
	const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
	const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3-flash-preview';

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
 */
function buildTranscriptionPrompt(ctx) {
	const speakerList = (ctx.speakers || [])
		.map(s => s.displayName)
		.join(', ') || 'Unknown';

	const durationMin = Math.round((ctx.durationSeconds || 0) / 60);

	let speakingTimelineSection = '';
	if (ctx.speakingTimeline && ctx.speakingTimeline.length > 0) {
		const coalesced = coalesceTimeline(ctx.speakingTimeline, ctx.startTime || ctx.scheduledTime || 0);
		if (coalesced.length > 0) {
			const timelineLines = coalesced.map(seg => {
				return `- [${formatMsToTimestamp(seg.startMs)} - ${formatMsToTimestamp(seg.endMs)}] ${seg.displayName}`;
			}).join('\n');

			speakingTimelineSection = `

## Voice Activity & Speaker Timeline (Deterministic)
The following timeline records exactly which participant was speaking at which relative time range in the audio file. Use this timeline as the absolute truth to attribute spoken content to the correct speaker names in the transcript:

${timelineLines}`;
		}
	}

	let vcChatSection = '';
	if (ctx.vcTextMessages && ctx.vcTextMessages.length > 0) {
		const startTime = ctx.startTime || ctx.scheduledTime || 0;
		const chatLines = ctx.vcTextMessages.map(msg => {
			const absoluteTime = new Date(msg.timestamp).toLocaleTimeString('en-IN', {
				timeZone: 'Asia/Kolkata',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
			});
			const relativeMs = msg.timestamp - startTime;
			const relativeTime = relativeMs >= 0 ? formatMsToTimestamp(relativeMs) : '00:00';
			return `[Audio Rel: ${relativeTime} | Abs: ${absoluteTime}] ${msg.author}: ${msg.content}`;
		}).join('\n');

		vcChatSection = `

## Text Messages from Voice Channel Chat
The following text messages were sent in the meeting's voice channel text chat during the meeting. The relative timestamp "[Audio Rel: MM:SS]" matches the time offset in the audio file. Use these to weave/integrate the text chat context into the final transcript at the appropriate moments to maintain a cohesive flow:

${chatLines}`;
	}

	return `You are a professional meeting transcriber and note-taker for the Bits&Bytes team.

## Meeting Information
- **Title**: ${ctx.title || 'Untitled Meeting'}
- **Duration**: ~${durationMin} minutes
- **Known Participants**: ${speakerList}${speakingTimelineSection}${vcChatSection}

## Your Task
Transcribe the audio recording of this meeting. The participants may speak in:
- **English**
- **Hindi** (हिन्दी)
- **Hinglish** (a natural mix of Hindi and English, very common in Indian workplaces)

### CRITICAL RULES:
1. **Transcribe in the ORIGINAL language spoken.** Do NOT translate. If someone says "yaar ye feature toh bahut important hai", write it exactly as spoken in Hinglish — do NOT convert to English.
2. **Speaker Identification & Attribution**: Use the provided "Voice Activity & Speaker Timeline" to identify who is speaking at any given time. This timeline is the absolute truth for speaker mapping. Since the audio is a single mixed channel, map the voices to the speaker names using the timestamps of the utterances and matching them with the timeline. Do not guess names; rely on the timeline. If someone speaks but is not in the timeline or cannot be determined, label them as "Speaker 1", "Speaker 2", etc.
3. **Timestamps**: Provide timestamps in [MM:SS] format relative to the start of the recording.
4. **For summary and action items**: Write these in English for consistency, even if the meeting was in Hindi/Hinglish.
5. **Integrate VC Text Chat**: If "Text Messages from Voice Channel Chat" are provided, weave them directly into both transcripts (fullTranscript and timestampedTranscript) at the appropriate relative timestamp matching the timeline. Use the format "(Text Chat) Author: message content" (and prefix with the timestamp in the timestamped transcript, e.g., "[MM:SS] (Text Chat) Author: message content") to clearly distinguish them from spoken audio, and make sure to capture their context in the summary/action items.

## Required Output Format
Respond with ONLY a valid JSON object (no markdown code blocks, no extra text) with these exact fields:

{
  "summary": "A clear 3-5 sentence summary of the meeting in English",
  "keyDecisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {"assignee": "Person Name", "task": "What they need to do", "deadline": "By when (if mentioned)"}
  ],
  "fullTranscript": "Speaker-labeled transcript with paragraphs. Use the speaker's name followed by a colon.",
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
 * Coalesces consecutive speaking segments for the same speaker if the gap between them is small.
 * Filters out short voice activity (e.g. < 500ms) to avoid noise.
 * Returns sorted list of segments formatted with timestamps relative to the meeting start.
 * 
 * @param {Array<{userId: string, displayName: string, startTime: number, endTime: number}>} timeline
 * @param {number} sessionStartTime
 * @returns {Array<{displayName: string, startMs: number, endMs: number}>}
 */
function coalesceTimeline(timeline, sessionStartTime) {
	if (!timeline || timeline.length === 0) return [];

	// 1. Group by userId
	const userSegments = new Map();
	for (const event of timeline) {
		const duration = event.endTime - event.startTime;
		if (duration < 500) continue; // Filter out ultra-short background noise

		if (!userSegments.has(event.userId)) {
			userSegments.set(event.userId, []);
		}
		userSegments.get(event.userId).push({
			displayName: event.displayName,
			startMs: Math.max(0, event.startTime - sessionStartTime),
			endMs: Math.max(0, event.endTime - sessionStartTime),
		});
	}

	const allCoalesced = [];

	// 2. Coalesce each user's segments
	for (const [userId, segments] of userSegments) {
		// Sort segments by start time
		segments.sort((a, b) => a.startMs - b.startMs);

		const coalesced = [];
		let current = null;

		for (const seg of segments) {
			if (!current) {
				current = { ...seg };
			} else {
				const gap = seg.startMs - current.endMs;
				if (gap <= 2500) { // Merge if gap is 2.5 seconds or less
					current.endMs = Math.max(current.endMs, seg.endMs);
				} else {
					coalesced.push(current);
					current = { ...seg };
				}
			}
		}
		if (current) {
			coalesced.push(current);
		}

		allCoalesced.push(...coalesced);
	}

	// 3. Sort the combined list by start time
	allCoalesced.sort((a, b) => a.startMs - b.startMs);

	return allCoalesced;
}

module.exports = {
	transcribeMeeting,
	coalesceTimeline,
	formatMsToTimestamp,
};
