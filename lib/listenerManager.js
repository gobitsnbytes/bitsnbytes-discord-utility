const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
require('dotenv').config();

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

// Pre-warmed listener bot pool: Array of { client, token, busy: boolean, meetingId: string|null }
const listenerPool = [];

// Helper to set idle status for a listener bot (highly amusing & funny)
function setIdlePresence(client) {
	try {
		const listenerStatuses = [
			{ name: 'Virtual silence & loud key clacks', type: ActivityType.Listening },
			{ name: 'People forgetting they are muted', type: ActivityType.Listening },
			{ name: 'Hinglish gossip in the VC', type: ActivityType.Listening },
			{ name: 'Gemini translating human noises', type: ActivityType.Listening },
			{ name: 'Heavy breathing on open mics', type: ActivityType.Listening },
			{ name: 'VC Sync // bitsbytes Network', type: ActivityType.Listening }
		];
		const randomStatus = listenerStatuses[Math.floor(Math.random() * listenerStatuses.length)];
		client.user.setPresence({
			activities: [randomStatus],
			status: 'dnd'
		});
	} catch (presErr) {
		console.warn(`[LISTENER_MANAGER] Failed to set idle presence for ${client.user.tag}:`, presErr.message);
	}
}

// Helper to update bio for a listener bot (complying with e-MOA/e-AOA)
async function updateListenerBio(client) {
	try {
		const bio = "Authorized voice/meeting recording agent of the bitsbytes Network (stewarded by GOBITSNBYTES FOUNDATION). Automatically secures temporary voice channels, plays compliance consent warnings, and records meeting audio. Pipes streams directly to Gemini for speaker-labeled Hinglish/multilingual transcription and meeting briefs.";
		if (client.application) {
			await client.application.edit({ description: bio });
			console.log(`[LISTENER_MANAGER] Updated bio for listener bot ${client.user.tag}. The ears have walls! 👂`);
		}
	} catch (bioErr) {
		console.warn(`[LISTENER_MANAGER] Failed to update bio for listener bot ${client.user.tag}:`, bioErr.message);
	}
}

// Helper to enforce security rules for a listener bot (only allowed in GOBITSNBYTES server)
async function enforceSecurity(client) {
	const allowedGuildId = process.env.GUILD_ID || '1480617556292272260';
	
	// Leave unauthorized guilds on startup
	for (const [guildId, guild] of client.guilds.cache) {
		if (guildId !== allowedGuildId) {
			console.warn(`[SECURITY] Listener bot ${client.user.tag} is in unauthorized guild: ${guild.name} (${guildId}). Leaving...`);
			await guild.leave().catch(err => {
				console.error(`[SECURITY] Failed to leave unauthorized guild ${guildId}:`, err.message);
			});
		}
	}

	// Register a guildCreate event listener to leave unauthorized guilds immediately if invited
	client.on('guildCreate', async (guild) => {
		if (guild.id !== allowedGuildId) {
			console.warn(`[SECURITY] Listener bot ${client.user.tag} was invited to unauthorized guild: ${guild.name} (${guild.id}). Leaving immediately...`);
			await guild.leave().catch(err => {
				console.error(`[SECURITY] Failed to leave unauthorized guild ${guild.id}:`, err.message);
			});
		}
	});
}

/**
 * Initialize the pre-warmed pool of listener clients.
 * Logs in all configured listener bots on startup.
 */
async function initializePool() {
	if (listenerTokens.length === 0) {
		console.log('[LISTENER_MANAGER] No listener tokens configured in .env.');
		return;
	}

	console.log(`[LISTENER_MANAGER] Pre-warming listener pool with ${listenerTokens.length} bots...`);

	for (const token of listenerTokens) {
		// Avoid duplicate logins
		if (listenerPool.some(item => item.token === token)) continue;

		const client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildVoiceStates
			]
		});

		try {
			// ⚡ Deploying the auditory pool bot...
			await client.login(token);

			// Wait for ready state
			await new Promise((resolve) => {
				if (client.isReady()) resolve();
				else client.once('ready', resolve);
			});

			console.log(`[LISTENER_MANAGER] Listener bot ${client.user.tag} logged in and added to pool.`);

			setIdlePresence(client);
			await updateListenerBio(client).catch(() => {});
			await enforceSecurity(client).catch(() => {});

			listenerPool.push({
				client,
				token,
				busy: false,
				meetingId: null
			});
		} catch (err) {
			console.error(`[LISTENER_MANAGER] Failed to login listener bot:`, err.message);
			try { client.destroy(); } catch {}
		}
	}
}

/**
 * Allocate a listener client for a meeting from the pre-warmed pool.
 * Falls back to null if no bots are available.
 * 
 * @param {string} meetingId
 * @returns {Promise<Client|null>}
 */
async function allocateListener(meetingId) {
	// If the pool is empty but we have tokens, attempt initialization (safety fallback)
	if (listenerPool.length === 0 && listenerTokens.length > 0) {
		await initializePool();
	}

	// Check if already allocated to this meeting
	const active = listenerPool.find(item => item.meetingId === meetingId);
	if (active) return active.client;

	// Find the first free listener
	const freeItem = listenerPool.find(item => !item.busy);
	if (!freeItem) {
		console.warn(`[LISTENER_MANAGER] No free listener bots available for meeting ${meetingId}.`);
		return null;
	}

	freeItem.busy = true;
	freeItem.meetingId = meetingId;

	console.log(`[LISTENER_MANAGER] Allocated listener bot ${freeItem.client.user.tag} for meeting ${meetingId}.`);

	// Update presence to active recording status
	try {
		freeItem.client.user.setPresence({
			activities: [{ name: 'Recording VC // bitsbytes', type: ActivityType.Listening }],
			status: 'dnd'
		});
	} catch (presErr) {
		console.warn(`[LISTENER_MANAGER] Failed to set presence during allocation:`, presErr.message);
	}

	return freeItem.client;
}

/**
 * Release a listener client for a meeting back to the pool.
 * 
 * @param {string} meetingId
 */
function releaseListener(meetingId) {
	const item = listenerPool.find(item => item.meetingId === meetingId);
	if (!item) return;

	console.log(`[LISTENER_MANAGER] Releasing listener bot ${item.client.user.tag} from meeting ${meetingId}...`);
	item.busy = false;
	item.meetingId = null;

	// Reset to idle status/presence
	setIdlePresence(item.client);
	console.log(`[LISTENER_MANAGER] Listener bot is now idle and back in the pool.`);
}

/**
 * Get the active listener client for a meeting if it exists.
 * 
 * @param {string} meetingId
 * @returns {Client|null}
 */
function getActiveListener(meetingId) {
	const item = listenerPool.find(item => item.meetingId === meetingId);
	return item ? item.client : null;
}

/**
 * Get the status of the listener pool.
 * 
 * @returns {{total: number, busy: number, available: number}}
 */
function getListenerStatus() {
	const total = listenerPool.length;
	const busy = listenerPool.filter(item => item.busy).length;
	return {
		total,
		busy,
		available: total - busy
	};
}

/**
 * Terminate all listener client sessions and clear the pool.
 */
function closePool() {
	console.log(`[LISTENER_MANAGER] Closing all listener clients in pool...`);
	for (const item of listenerPool) {
		try {
			item.client.destroy();
		} catch (err) {
			console.warn(`[LISTENER_MANAGER] Error destroying listener client:`, err.message);
		}
	}
	listenerPool.length = 0;
}

module.exports = {
	initializePool,
	allocateListener,
	releaseListener,
	getActiveListener,
	hasListenerTokens: () => listenerTokens.length > 0,
	getListenerStatus,
	closePool
};
