/**
 * 📨 Transcript Delivery — Formats and DMs meeting transcripts to attendees
 * Part of the Bits&Bytes Meeting Transcript Agent
 */

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const config = require('../config');
const { resolveAttendeeUserIds } = require('./meetingsHelper');

// ─────────────────────────────────────────────────────────
//  VC Text Message Interleaver
// ─────────────────────────────────────────────────────────

/**
 * Parse a [MM:SS] timestamp string into total seconds.
 * Returns Infinity if the string doesn't match the pattern.
 * @param {string} str
 * @returns {number}
 */
function parseTimestampToSeconds(str) {
	const m = str.match(/^(\d+):(\d{2})$/);
	if (!m) return Infinity;
	return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Merge VC text-chat messages into a timestamped transcript string.
 *
 * How it works:
 *  1. Split the Gemini-produced timestampedTranscript on newlines.
 *  2. Build an index of (lineIndex → secondsValue) for every line
 *     that starts with [MM:SS].
 *  3. For each VC text message (which has an absolute ms timestamp),
 *     compute its relative seconds from meeting start, then binary-search
 *     to find the line it should be inserted *after*.
 *  4. Collect all insertions, apply them back-to-front so index positions
 *     stay valid, and return the merged string.
 *
 * @param {string} timestampedTranscript - Gemini output: "[MM:SS] Speaker: ..."
 * @param {Array<{author: string, content: string, timestamp: number, attachments?: string[]}>} vcTextMessages
 * @param {number} meetingStartMs - Absolute ms timestamp when recording started
 * @returns {string} merged transcript
 */
function mergeTextMessagesIntoTranscript(timestampedTranscript, vcTextMessages, meetingStartMs) {
	if (!vcTextMessages || vcTextMessages.length === 0) return timestampedTranscript;
	if (!timestampedTranscript || !timestampedTranscript.trim()) return timestampedTranscript;

	const lines = timestampedTranscript.split('\n');

	// Build index: for each line that begins with [MM:SS], record its seconds value
	const lineSeconds = lines.map(line => {
		const m = line.match(/^\[(\d+:\d{2})\]/);
		if (!m) return null;
		return parseTimestampToSeconds(m[1]);
	});

	// Sorted ms→seconds list of transcript anchor points with their line indices
	const anchors = lineSeconds
		.map((sec, idx) => ({ sec, idx }))
		.filter(a => a.sec !== null);

	// For each VC message, find where to insert it
	// insertions: Array<{ afterLineIdx: number, text: string }>
	const insertions = [];

	for (const msg of vcTextMessages) {
		const relSec = Math.max(0, Math.round((msg.timestamp - meetingStartMs) / 1000));
		const mm = String(Math.floor(relSec / 60)).padStart(2, '0');
		const ss = String(relSec % 60).padStart(2, '0');
		const attachNote = msg.attachments && msg.attachments.length > 0
			? ` [📎 ${msg.attachments.join(', ')}]` : '';
		const chatLine = `[${mm}:${ss}] (Text Chat) ${msg.author}: ${msg.content}${attachNote}`;

		// Binary search: find the last anchor whose seconds ≤ relSec
		let lo = 0, hi = anchors.length - 1, insertAfter = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (anchors[mid].sec <= relSec) {
				insertAfter = anchors[mid].idx;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}

		// If message predates all transcript lines, insert at the very top
		if (insertAfter === -1) insertAfter = -1;

		insertions.push({ afterLineIdx: insertAfter, text: chatLine });
	}

	// Sort insertions in reverse order so back-to-front insertion doesn't shift indices
	insertions.sort((a, b) => b.afterLineIdx - a.afterLineIdx);

	for (const ins of insertions) {
		const pos = ins.afterLineIdx + 1; // insert AFTER this index
		lines.splice(pos, 0, ins.text);
	}

	return lines.join('\n');
}


/**
 * Deliver meeting transcript to all attendees via DM.
 * 
 * @param {import('discord.js').Guild} guild - The Discord guild
 * @param {Object} meeting - The meeting object from DB
 * @param {Object} transcriptData - Parsed transcript data from Gemini
 * @param {string} transcriptData.summary - Meeting summary
 * @param {Array<string>} transcriptData.keyDecisions - Key decisions made
 * @param {Array<{assignee: string, task: string, deadline?: string}>} transcriptData.actionItems - Action items
 * @param {string} transcriptData.fullTranscript - Full speaker-labeled transcript
 * @param {string} transcriptData.timestampedTranscript - Timestamped transcript
 * @param {number} transcriptData.durationSeconds - Meeting duration
 * @param {number} transcriptData.speakerCount - Number of speakers
 * @param {import('discord.js').Client} client - The Discord client
 * @returns {Promise<{sent: number, failed: number}>}
 */
async function deliverTranscript(guild, meeting, transcriptData, client) {
	const results = { sent: 0, failed: 0 };

	try {
		// Resolve all attendee user IDs (handles role-based attendees)
		const attendees = meeting.attendees || [];
		const userIds = await resolveAttendeeUserIds(guild, attendees);

		if (userIds.size === 0) {
			console.warn(`[DELIVERY] No attendees found for meeting "${meeting.title}" (${meeting.id})`);
			return results;
		}

		// Build the summary embed
		const embed = buildSummaryEmbed(meeting, transcriptData);

		// Build transcript as .txt file attachment
		const transcriptText = buildTranscriptText(meeting, transcriptData);
		const sanitizedTitle = (meeting.title || 'meeting').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
		const dateStr = new Date(meeting.scheduled_time).toISOString().split('T')[0];
		const fileName = `meeting-transcript-${sanitizedTitle}-${dateStr}.txt`;
		const attachment = new AttachmentBuilder(Buffer.from(transcriptText, 'utf-8'), { name: fileName });

		console.log(`[DELIVERY] Sending transcript for "${meeting.title}" to ${userIds.size} attendees...`);

		// DM each attendee with rate limiting
		for (const userId of userIds) {
			try {
				const member = await guild.members.fetch(userId).catch(() => null);
				if (!member || member.user.bot) continue;

				await member.send({
					embeds: [embed],
					files: [attachment],
					content: '💡 *Use `/meet-transcript` to retrieve this anytime.*'
				}).catch((dmErr) => {
					// DM might be disabled
					console.warn(`[DELIVERY] Could not DM user ${member.user.username} (${userId}): ${dmErr.message}`);
					results.failed++;
				});

				results.sent++;

				// Rate limit: 1 DM per second to avoid Discord API limits
				await sleep(config.RECORDING?.dmRateLimitMs || 1000);
			} catch (err) {
				console.warn(`[DELIVERY] Error sending to user ${userId}:`, err.message);
				results.failed++;
			}
		}

		console.log(`[DELIVERY] Transcript delivery complete: ${results.sent} sent, ${results.failed} failed`);
	} catch (err) {
		console.error(`[DELIVERY] Fatal error delivering transcript for meeting ${meeting.id}:`, err);
	}

	return results;
}

/**
 * Build the summary embed for DMs.
 */
function buildSummaryEmbed(meeting, data) {
	const scheduledDate = new Date(meeting.scheduled_time);
	const durationMin = Math.round((data.durationSeconds || 0) / 60);
	const dateStr = scheduledDate.toLocaleString('en-IN', {
		timeZone: 'Asia/Kolkata',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	}) + ' IST';

	const embed = new EmbedBuilder()
		.setTitle(`📝 Meeting Notes: "${meeting.title}"`)
		.setColor(config.COLORS.primary)
		.setTimestamp()
		.setFooter({ text: config.BRANDING.footerText });

	// Header info
	embed.setDescription(
		`📅 ${dateStr}\n` +
		`👥 ${data.speakerCount || '?'} speakers • ${durationMin} min duration\n` +
		`🎙️ Recorded & transcribed by Bits&Bytes Bot`
	);

	// Summary
	if (data.summary) {
		embed.addFields({
			name: '━━━ Summary ━━━',
			value: truncate(data.summary, 1024),
			inline: false
		});
	}

	// Key Decisions
	if (data.keyDecisions && data.keyDecisions.length > 0) {
		const decisions = data.keyDecisions
			.map(d => `• ${d}`)
			.join('\n');
		embed.addFields({
			name: '━━━ Key Decisions ━━━',
			value: truncate(decisions, 1024),
			inline: false
		});
	}

	// Action Items
	if (data.actionItems && data.actionItems.length > 0) {
		const items = data.actionItems
			.map(a => {
				const deadline = a.deadline ? ` (by ${a.deadline})` : '';
				return `☐ **${a.assignee}** → ${a.task}${deadline}`;
			})
			.join('\n');
		embed.addFields({
			name: '━━━ Action Items ━━━',
			value: truncate(items, 1024),
			inline: false
		});
	}

	return embed;
}

/**
 * Build the full transcript text file content.
 * VC text messages are interleaved at correct positions by JS, not by the LLM.
 */
function buildTranscriptText(meeting, data) {
	const scheduledDate = new Date(meeting.scheduled_time);
	const dateStr = scheduledDate.toLocaleString('en-IN', {
		timeZone: 'Asia/Kolkata',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	}) + ' IST';
	const durationMin = Math.round((data.durationSeconds || 0) / 60);

	// Interleave VC text messages into the timestamped transcript by JS
	const mergedTranscript = data.vcTextMessages && data.vcTextMessages.length > 0 && data.timestampedTranscript
		? mergeTextMessagesIntoTranscript(data.timestampedTranscript, data.vcTextMessages, data.meetingStartMs || 0)
		: data.timestampedTranscript;

	let text = '';
	text += `═══════════════════════════════════════════════════\n`;
	text += `  MEETING TRANSCRIPT: ${meeting.title}\n`;
	text += `  ${dateStr} • ${durationMin} min • ${data.speakerCount || '?'} speakers\n`;
	text += `═══════════════════════════════════════════════════\n\n`;

	if (data.summary) {
		text += `── SUMMARY ──\n${data.summary}\n\n`;
	}

	if (data.keyDecisions && data.keyDecisions.length > 0) {
		text += `── KEY DECISIONS ──\n`;
		data.keyDecisions.forEach(d => { text += `  • ${d}\n`; });
		text += '\n';
	}

	if (data.actionItems && data.actionItems.length > 0) {
		text += `── ACTION ITEMS ──\n`;
		data.actionItems.forEach(a => {
			const deadline = a.deadline ? ` (by ${a.deadline})` : '';
			text += `  ☐ ${a.assignee} → ${a.task}${deadline}\n`;
		});
		text += '\n';
	}

	text += `══════════════════════════════════════════════════\n`;
	text += `  TIMESTAMPED TRANSCRIPT\n`;
	text += `══════════════════════════════════════════════════\n\n`;

	if (mergedTranscript) {
		text += mergedTranscript;
	} else if (data.fullTranscript) {
		text += data.fullTranscript;
	} else {
		text += '(No transcript available)\n';
	}

	text += `\n\n── Generated by Bits&Bytes Bot ──\n`;
	return text;
}

/**
 * Truncate text to a max length with ellipsis.
 */
function truncate(str, max) {
	if (!str) return '';
	if (str.length <= max) return str;
	return str.substring(0, max - 3) + '...';
}

/**
 * Simple sleep utility.
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { deliverTranscript };
