const { Client, GatewayIntentBits } = require('discord.js');

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
