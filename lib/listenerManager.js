const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

// Configuration: dynamically load all listener tokens starting with LISTENER_TOKEN_ from env
const listenerTokens = Object.keys(process.env)
	.filter(key => key.startsWith('LISTENER_TOKEN_'))
	.sort((a, b) => {
		const numA = parseInt(a.replace('LISTENER_TOKEN_', ''), 10);
		const numB = parseInt(b.replace('LISTENER_TOKEN_', ''), 10);
		return numA - numB;
	})
	.map(key => process.env[key])
	.filter(Boolean);

// Map of meetingId -> { client, token }
const activeListeners = new Map();

// Map of token -> boolean (busy status)
const busyTokens = new Map();
for (const token of listenerTokens) {
	busyTokens.set(token, false);
}

/**
 * Allocate a listener client for a meeting.
 * Logs in a free listener bot on-demand.
 * Falls back to null if no tokens are configured or all are busy.
 * 
 * @param {string} meetingId
 * @returns {Promise<Client|null>}
 */
async function allocateListener(meetingId) {
	if (activeListeners.has(meetingId)) {
		return activeListeners.get(meetingId).client;
	}

	// Find the first free token
	let freeToken = null;
	for (const token of listenerTokens) {
		if (!busyTokens.get(token)) {
			freeToken = token;
			break;
		}
	}

	if (!freeToken) {
		console.log(`[LISTENER_MANAGER] No free listener bots available for meeting ${meetingId}.`);
		return null;
	}

	busyTokens.set(freeToken, true);

	console.log(`[LISTENER_MANAGER] Logging in listener bot for meeting ${meetingId}...`);
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates
		]
	});

	try {
		await Promise.race([
			(async () => {
				await client.login(freeToken);
				
				// Wait for ready state
				await new Promise((resolve) => {
					if (client.isReady()) resolve();
					else client.once('ready', resolve);
				});
			})(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('Login timeout')), 10000))
		]);

		console.log(`[LISTENER_MANAGER] Listener bot ${client.user.tag} is ready for meeting ${meetingId}.`);

		// Set cool presence/status activity for the listener bot
		try {
			let meetingTitle = null;
			try {
				const meetingsDb = require('./meetingsDb');
				const meeting = await meetingsDb.getMeeting(meetingId);
				if (meeting) {
					meetingTitle = meeting.title;
				}
			} catch (dbErr) {
				// Ignore database errors
			}

			const activityName = meetingTitle ? `"${meetingTitle}"` : 'Bits&Bytes Meeting';
			client.user.setPresence({
				activities: [{ name: activityName, type: ActivityType.Listening }],
				status: 'dnd'
			});
		} catch (presErr) {
			console.warn(`[LISTENER_MANAGER] Failed to set presence:`, presErr.message);
		}

		// Set cool bio/About Me description for the listener bot
		try {
			const bio = "Bits&Bytes Meeting Agent — Secure temporary voice channel recording and Hinglish/multilingual meeting transcription engine powered by Gemini.";
			if (client.application) {
				await client.application.edit({ description: bio });
				console.log(`[LISTENER_MANAGER] Updated bio for listener bot ${client.user.tag}.`);
			}
		} catch (bioErr) {
			console.warn(`[LISTENER_MANAGER] Failed to update bio for listener bot ${client.user.tag}:`, bioErr.message);
		}

		activeListeners.set(meetingId, { client, token: freeToken });
		return client;
	} catch (err) {
		console.error(`[LISTENER_MANAGER] Failed to login listener bot for meeting ${meetingId}:`, err.message);
		busyTokens.set(freeToken, false);
		try { client.destroy(); } catch {}
		return null;
	}
}

/**
 * Release a listener client for a meeting.
 * Destroys the client instance (logging it off) and frees the token.
 * 
 * @param {string} meetingId
 */
function releaseListener(meetingId) {
	const session = activeListeners.get(meetingId);
	if (!session) return;

	console.log(`[LISTENER_MANAGER] Logging off listener bot for meeting ${meetingId}...`);
	try {
		session.client.destroy();
	} catch (err) {
		console.warn(`[LISTENER_MANAGER] Error destroying listener client:`, err.message);
	}

	busyTokens.set(session.token, false);
	activeListeners.delete(meetingId);
	console.log(`[LISTENER_MANAGER] Listener bot freed.`);
}

/**
 * Get the active listener client for a meeting if it exists.
 * 
 * @param {string} meetingId
 * @returns {Client|null}
 */
function getActiveListener(meetingId) {
	const session = activeListeners.get(meetingId);
	return session ? session.client : null;
}
/**
 * Get the status of the listener pool.
 * 
 * @returns {{total: number, busy: number, available: number}}
 */
function getListenerStatus() {
	const total = listenerTokens.length;
	let busy = 0;
	for (const token of listenerTokens) {
		if (busyTokens.get(token)) {
			busy++;
		}
	}
	return {
		total,
		busy,
		available: total - busy
	};
}

module.exports = {
	allocateListener,
	releaseListener,
	getActiveListener,
	hasListenerTokens: () => listenerTokens.length > 0,
	getListenerStatus
};
