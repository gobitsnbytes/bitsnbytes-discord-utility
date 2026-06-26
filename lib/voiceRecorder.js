/**
 * 🎙️ Voice Recorder — Core voice recording engine for Discord meetings
 * Part of the Bits&Bytes Meeting Transcript Agent
 * 
 * Joins a meeting VC, subscribes to each user's Opus audio stream,
 * and pipes them directly to disk as .ogg files (zero in-memory buffering).
 * Handles user join/leave/rejoin with multi-segment tracking.
 * Plays consent TTS (English + Hindi) and sends legal notice in VC chat.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pipeline } = require('stream');

const {
	joinVoiceChannel,
	VoiceConnectionStatus,
	EndBehaviorType,
	entersState,
	createAudioPlayer,
	createAudioResource,
	AudioPlayerStatus,
} = require('@discordjs/voice');

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const prism = require('prism-media');
const config = require('../config');
const { VcTextCollector } = require('./vcTextCollector');
const listenerManager = require('./listenerManager');

// ═══════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════

/** @type {Map<string, RecordingSession>} meetingId → session */
const activeRecordings = new Map();
const recordingStartInProgress = new Set();

// ═══════════════════════════════════════════════════════════
//  Start Recording
// ═══════════════════════════════════════════════════════════

/**
 * Start recording a voice channel for a meeting.
 * Joins the VC, plays consent TTS (EN + HI), sends consent text in VC chat,
 * and subscribes to all users' audio streams.
 * 
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {string} meetingId
 * @param {import('discord.js').Client} client
 */
async function startRecording(voiceChannel, meetingId, mainClient) {
	if (activeRecordings.has(meetingId) || recordingStartInProgress.has(meetingId)) {
		console.warn(`[RECORDING] Already recording or start in progress for meeting ${meetingId}`);
		return;
	}
	recordingStartInProgress.add(meetingId);
	try {

	// 1. Allocate a listener bot from pool (falls back to mainClient if none configured/free)
	const listenerClient = await listenerManager.allocateListener(meetingId);
	const recordingClient = listenerClient || mainClient;
	const joiningClientId = recordingClient?.user?.id || 'mock_client_id';

	// Check concurrent recording limit
	const maxConcurrent = config.RECORDING?.maxConcurrentRecordings || 3;
	if (activeRecordings.size >= maxConcurrent) {
		console.warn(`[RECORDING] Max concurrent recordings (${maxConcurrent}) reached. Skipping meeting ${meetingId}`);
		if (listenerClient) listenerManager.releaseListener(meetingId);
		return;
	}

	// Check if already recording in the same guild using the SAME bot client
	for (const activeSession of activeRecordings.values()) {
		if (activeSession.guildId === voiceChannel.guild.id && activeSession.clientId === joiningClientId) {
			console.warn(`[RECORDING] Client ${recordingClient?.user?.tag || 'Bot'} already recording in guild ${voiceChannel.guild.id}. Cannot join another VC.`);
			if (listenerClient) listenerManager.releaseListener(meetingId);
			return;
		}
	}

	// Create temp directory
	const baseDir = config.RECORDING?.tempDir || path.join(os.tmpdir(), 'bnb-recordings');
	const meetingDir = path.join(baseDir, meetingId);
	fs.mkdirSync(meetingDir, { recursive: true });

	console.log(`[RECORDING] Client ${recordingClient.user.tag} joining VC "${voiceChannel.name}" for meeting ${meetingId}`);

	// Fetch guild/channel using the recording bot client to resolve voiceAdapterCreator correctly
	let recordingVoiceChannel = voiceChannel;
	if (listenerClient) {
		try {
			const listenerGuild = await listenerClient.guilds.fetch(voiceChannel.guild.id);
			const resolvedChannel = await listenerGuild.channels.fetch(voiceChannel.id);
			if (resolvedChannel) {
				recordingVoiceChannel = resolvedChannel;
			} else {
				console.warn(`[RECORDING] Listener client could not find voice channel ${voiceChannel.id} in guild. Falling back to main bot client.`);
			}
		} catch (err) {
			console.warn(`[RECORDING] Listener client failed to fetch voice channel: ${err.message}. Falling back to main bot client.`);
		}
	}

	// Join the voice channel
	const connection = joinVoiceChannel({
		channelId: recordingVoiceChannel.id,
		guildId: recordingVoiceChannel.guild.id,
		adapterCreator: recordingVoiceChannel.guild.voiceAdapterCreator,
		selfDeaf: false,
		selfMute: true,
	});

	try {
		await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
		console.log(`[RECORDING] Connected to VC for meeting ${meetingId}`);
	} catch (err) {
		console.error(`[RECORDING] Failed to connect for meeting ${meetingId}:`, err.message);
		connection.destroy();
		if (listenerClient) listenerManager.releaseListener(meetingId);
		return;
	}

	// Create text collector for VC chat (always uses mainClient)
	const textCollector = new VcTextCollector(voiceChannel.id, mainClient, async (cmd) => {
		if (cmd === 'hindi') {
			await playHindiConsent(meetingId).catch(err => {
				console.error(`[RECORDING] Error playing Hindi consent on command:`, err.message);
			});
		}
	});

	// Build session
	const session = {
		meetingId,
		connection,
		users: new Map(),
		textCollector,
		startTime: Date.now(),
		meetingDir,
		client: recordingClient, // The client doing the recording
		mainClient, // Store the main client for text actions
		clientId: joiningClientId,
		channelId: voiceChannel.id,
		guildId: voiceChannel.guild.id,
		adapterCreator: recordingVoiceChannel.guild.voiceAdapterCreator,
		consentedUsers: new Set(),
		hasPlayedConsentAudio: false,
		isRecordingActive: false,
		speakingTimeline: [],
		speakingStates: new Map(),
	};
	activeRecordings.set(meetingId, session);

	// Load / restore metadata from a previous shutdown
	const metadataPath = path.join(meetingDir, 'metadata.json');
	if (fs.existsSync(metadataPath)) {
		try {
			const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
			for (const userRec of raw.segments || []) {
				session.users.set(userRec.userId, {
					userId: userRec.userId,
					displayName: userRec.displayName,
					segments: userRec.segments || [],
					currentStream: null,
					currentFileStream: null,
					partNumber: userRec.segments ? userRec.segments.length : 0
				});
			}
			session.startTime = raw.startTime || Date.now();
			session.speakingTimeline = raw.speakingTimeline || [];
			session.hasPlayedConsentAudio = raw.hasPlayedConsentAudio || false;
			session.isRecordingActive = raw.isRecordingActive || false;
			session.consentedUsers = new Set(raw.consentedUsers || []);
			if (raw.textMessages && Array.isArray(raw.textMessages)) {
				session.textCollector.messages.push(...raw.textMessages);
			}
			console.log(`[RECORDING] Restored session state for meeting ${meetingId} from metadata.json`);
			fs.unlinkSync(metadataPath);
		} catch (err) {
			console.error(`[RECORDING] Failed to restore metadata.json:`, err.message);
		}
	}

	// ── Step 1: Send consent text via mainClient (individually for each user if not already done) ──
	const mainGuild = await mainClient.guilds.fetch(voiceChannel.guild.id).catch(() => null);
	const mainVoiceChannel = mainGuild ? await mainGuild.channels.fetch(voiceChannel.id).catch(() => null) : null;
	
	// Fetch VC members using the recordingClient (which is actually in VC) to ensure accurate cache
	const recordingGuild = await recordingClient.guilds.fetch(voiceChannel.guild.id).catch(() => null);
	const recordingVC = recordingGuild ? await recordingGuild.channels.fetch(voiceChannel.id).catch(() => null) : null;
	const presentMembers = recordingVC ? [...recordingVC.members.values()].filter(m => !m.user.bot) : [];

	for (const member of presentMembers) {
		if (!session.consentedUsers.has(member.id)) {
			session.consentedUsers.add(member.id);
			if (mainVoiceChannel) {
				await sendIndividualConsent(mainVoiceChannel, member, meetingId).catch(err => {
					console.warn(`[RECORDING] Could not send consent message to ${member.displayName}: ${err.message}`);
				});
			}
			await sleep(200);
		}
	}

	// ── Step 2: Check if we have at least 2 people to start recording immediately or resume from recovery ──
	if (session.isRecordingActive) {
		console.log(`[RECORDING] Resuming active recording for meeting ${meetingId}. Skipping consent audio.`);
		for (const member of presentMembers) {
			subscribeToUser(session, member.id, member.displayName);
		}
	} else if (presentMembers.length >= 2) {
		session.isRecordingActive = true;
		session.startTime = Date.now(); // Start meeting clock at actual voice start
		session.hasPlayedConsentAudio = true;
		
		await playConsentAudio(connection, session).catch(err => {
			console.warn(`[RECORDING] Consent audio playback issue: ${err.message}`);
		});

		for (const member of presentMembers) {
			subscribeToUser(session, member.id, member.displayName);
		}
	}

		// ── Step 3: Setup dynamic speaking receiver listener ──
		setupSpeakingReceiver(session);

		setupDisconnectHandler(connection, meetingId);

		console.log(`[RECORDING] ✅ Recording started for meeting ${meetingId} with ${session.users.size} users`);
	} finally {
		recordingStartInProgress.delete(meetingId);
	}
}

// ═══════════════════════════════════════════════════════════
//  Consent System
// ═══════════════════════════════════════════════════════════

/**
 * Helper to dynamically change selfMute status on a voice connection.
 */
function setSelfMute(session, mute) {
	try {
		const connection = joinVoiceChannel({
			channelId: session.channelId,
			guildId: session.guildId,
			adapterCreator: session.adapterCreator,
			selfDeaf: false,
			selfMute: mute,
		});
		session.connection = connection;
	} catch (err) {
		console.warn(`[RECORDING] Failed to set selfMute to ${mute}:`, err.message);
	}
}

/**
 * Play consent TTS audio files: English first, then Hindi.
 * Unmutes the bot temporarily to play audio, then re-mutes.
 */
async function playConsentAudio(connection, session = null) {
	const consent = config.RECORDING?.consent || {};
	const enFile = path.resolve(consent.audioEnglish || './assets/english.mp3');

	if (!fs.existsSync(enFile)) {
		console.log(`[RECORDING] Consent audio file not found at ${enFile} — skipping TTS playback`);
		return;
	}

	console.log(`[RECORDING] Playing English consent audio notice`);

	// Unmute to play
	if (session) setSelfMute(session, false);

	const player = createAudioPlayer();
	connection.subscribe(player);

	await new Promise((resolve) => {
		const resource = createAudioResource(enFile);
		player.play(resource);

		const timeout = setTimeout(() => {
			player.stop();
			resolve();
		}, 90_000); // 90s max

		player.once(AudioPlayerStatus.Idle, () => {
			clearTimeout(timeout);
			resolve();
		});

		player.once('error', (err) => {
			clearTimeout(timeout);
			console.warn(`[RECORDING] Audio playback error for ${path.basename(enFile)}:`, err.message);
			resolve();
		});
	});

	// Re-mute after playing
	if (session) setSelfMute(session, true);
}

/**
 * Play Hindi consent audio notice in the voice channel.
 * Called when a command is typed or on-demand.
 * 
 * @param {string} meetingId
 * @returns {Promise<boolean>}
 */
async function playHindiConsent(meetingId) {
	const session = activeRecordings.get(meetingId);
	if (!session) {
		console.warn(`[RECORDING] No active session to play Hindi consent for meeting ${meetingId}`);
		return false;
	}
	const consent = config.RECORDING?.consent || {};
	const hiFile = path.resolve(consent.audioHindi || './assets/hindi.mp3');
	if (!fs.existsSync(hiFile)) {
		console.warn(`[RECORDING] Hindi consent audio file not found at ${hiFile}`);
		return false;
	}

	console.log(`[RECORDING] Playing Hindi consent audio in meeting ${meetingId}`);

	// Unmute to play
	setSelfMute(session, false);

	const player = createAudioPlayer();
	session.connection.subscribe(player);

	const success = await new Promise((resolve) => {
		const resource = createAudioResource(hiFile);
		player.play(resource);

		const timeout = setTimeout(() => {
			player.stop();
			resolve(true);
		}, 90_000); // 90s max

		player.once(AudioPlayerStatus.Idle, () => {
			clearTimeout(timeout);
			resolve(true);
		});

		player.once('error', (err) => {
			clearTimeout(timeout);
			console.warn(`[RECORDING] Hindi audio playback error:`, err.message);
			resolve(false);
		});
	});

	// Re-mute after playing
	setSelfMute(session, true);

	return success;
}

/**
 * Send consent notice to an individual member in the VC text chat.
 * @mentioning the member, with Hindi button.
 * 
 * @param {import('discord.js').VoiceChannel|import('discord.js').BaseChannel} channel
 * @param {import('discord.js').GuildMember} member
 * @param {string} meetingId
 */
async function sendIndividualConsent(channel, member, meetingId) {
	const consent = config.RECORDING?.consent || {};
	const englishText = consent.textEnglish || '⚠️ This meeting is being recorded.';

	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`consent_hindi_${meetingId}`)
			.setLabel('हिन्दी में देखें')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('🇮🇳')
	);

	await channel.send({
		content: `<@${member.id}>\n\n${englishText}`,
		components: [row],
	});

	console.log(`[RECORDING] Sent consent notice to ${member.displayName} in meeting ${meetingId}`);
}

/**
 * Handle the Hindi consent button interaction.
 * Called from interactionCreate event handler.
 * 
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleConsentButton(interaction) {
	const consent = config.RECORDING?.consent || {};
	const hindiText = consent.textHindi || '⚠️ यह बैठक रिकॉर्ड की जा रही है।';

	await interaction.reply({
		content: hindiText,
		ephemeral: true, // Only the user who clicked sees it
	});
}

// ═══════════════════════════════════════════════════════════
//  User Stream Management
// ═══════════════════════════════════════════════════════════

/**
 * Subscribe to a user's audio stream and pipe to disk.
 */
function subscribeToUser(session, userId, displayName) {
	if (session.users.has(userId)) {
		const existing = session.users.get(userId);
		if (existing.currentStream && !existing.currentStream.destroyed) {
			return; // Already recording
		}
	}

	const partNumber = session.users.has(userId)
		? session.users.get(userId).partNumber + 1
		: 1;

	const fileName = `${userId}_part${partNumber}.ogg`;
	const filePath = path.join(session.meetingDir, fileName);

	try {
		const receiver = session.connection.receiver;

		const opusStream = receiver.subscribe(userId, {
			end: { behavior: EndBehaviorType.Manual },
		});

		const oggStream = new prism.opus.OggLogicalBitstream({
			opusHead: new prism.opus.OpusHead({
				channelCount: 2,
				sampleRate: 48000,
			}),
			pageSizeControl: {
				maxPackets: 10,
			},
		});

		const fileStream = fs.createWriteStream(filePath);

		const segment = {
			file: filePath,
			startedAt: Date.now(),
			endedAt: null,
		};

		// Pipe: opus → ogg container → file
		pipeline(opusStream, oggStream, fileStream, (err) => {
			if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
				console.warn(`[RECORDING] Stream error for ${displayName}:`, err.message);
			}
			segment.endedAt = Date.now();
			saveMetadata(session.meetingId);
		});

		const userRecording = session.users.get(userId) || {
			userId,
			displayName,
			segments: [],
			currentStream: null,
			currentFileStream: null,
			partNumber: 0,
		};

		userRecording.segments.push(segment);
		userRecording.currentStream = opusStream;
		userRecording.currentFileStream = fileStream;
		userRecording.partNumber = partNumber;
		session.users.set(userId, userRecording);

		console.log(`[RECORDING] Subscribed to ${displayName} (${userId}) — part${partNumber}`);
	} catch (err) {
		console.error(`[RECORDING] Failed to subscribe to ${displayName}:`, err.message);
	}
}

// ═══════════════════════════════════════════════════════════
//  User Join / Leave Handlers
// ═══════════════════════════════════════════════════════════

/**
 * Handle a user joining the recorded meeting VC.
 * Sends late-joiner consent if they haven't been consented yet.
 */
async function handleUserJoin(meetingId, member) {
	const session = activeRecordings.get(meetingId);
	if (!session || member.user.bot) return;

	console.log(`[RECORDING] User ${member.displayName} joined meeting ${meetingId}`);

	// Fetch VC channel using the client that is actually connected (session.client) to ensure populated cache
	const clientGuild = await session.client.guilds.fetch(session.guildId).catch(() => null);
	const channel = clientGuild ? await clientGuild.channels.fetch(session.channelId).catch(() => null) : null;
	const presentMembers = channel ? [...channel.members.values()].filter(m => !m.user.bot) : [];

	// ── Reconnection Recovery ──
	if (session.connection && (session.connection.state.status === VoiceConnectionStatus.Destroyed || session.connection.state.status === VoiceConnectionStatus.Disconnected)) {
		console.log(`[RECORDING] Voice connection for meeting ${meetingId} was disconnected/destroyed. Attempting to re-join VC...`);
		try {
			const guildObj = await session.client.guilds.fetch(session.guildId).catch(() => null);
			const vcChannel = guildObj ? await guildObj.channels.fetch(session.channelId).catch(() => null) : null;
			
			if (vcChannel) {
				const connection = joinVoiceChannel({
					channelId: session.channelId,
					guildId: session.guildId,
					adapterCreator: session.adapterCreator,
					selfDeaf: false,
					selfMute: true,
				});
				await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
				session.connection = connection;
				if (connection.receiver && connection.receiver.speaking) {
					connection.receiver.speaking.removeAllListeners('start');
					connection.receiver.speaking.removeAllListeners('end');
				}
				setupSpeakingReceiver(session);
				setupDisconnectHandler(connection, meetingId);
				console.log(`[RECORDING] Connected back to VC for meeting ${meetingId}`);
			} else {
				console.warn(`[RECORDING] Failed to resolve VC channel ${session.channelId} to re-join.`);
			}
		} catch (err) {
			console.error(`[RECORDING] Failed to re-join VC for meeting ${meetingId}:`, err.message);
		}
	}

	// If recording is not active yet, check if we hit the 2-person threshold
	if (!session.isRecordingActive) {
		if (presentMembers.length >= 2) {
			session.isRecordingActive = true;
			session.startTime = Date.now(); // Reset start time to actual meeting start!
			session.hasPlayedConsentAudio = true;

			// Play English TTS
			playConsentAudio(session.connection, session).catch(err => {
				console.warn(`[RECORDING] Consent audio playback issue: ${err.message}`);
			});

			// Subscribe to all present users (including the new joiner and the waiting ones)
			for (const m of presentMembers) {
				subscribeToUser(session, m.id, m.displayName);
			}
		}
	} else {
		// Recording is already active: subscribe to the new joiner immediately
		subscribeToUser(session, member.id, member.displayName);
	}

	// Send consent notice if they haven't been shown it yet
	if (!session.consentedUsers.has(member.id)) {
		session.consentedUsers.add(member.id);

		if (channel) {
			sendIndividualConsent(channel, member, meetingId).catch(err => {
				console.warn(`[RECORDING] Failed to send consent notice: ${err.message}`);
			});
		}
	}
}

/**
 * Handle a user leaving the recorded meeting VC.
 * Finalizes their current audio segment.
 */
async function handleUserLeave(meetingId, member) {
	const session = activeRecordings.get(meetingId);
	if (!session || member.user.bot) return;

	const userRecording = session.users.get(member.id);
	if (!userRecording) return;

	console.log(`[RECORDING] User ${member.displayName} left meeting ${meetingId} — finalizing segment`);

	if (userRecording.currentStream && !userRecording.currentStream.destroyed) {
		userRecording.currentStream.destroy();
		userRecording.currentStream = null;
	}
	if (userRecording.currentFileStream && !userRecording.currentFileStream.destroyed) {
		userRecording.currentFileStream.end();
		userRecording.currentFileStream = null;
	}

	const lastSegment = userRecording.segments[userRecording.segments.length - 1];
	if (lastSegment && !lastSegment.endedAt) {
		lastSegment.endedAt = Date.now();
	}
}

// ═══════════════════════════════════════════════════════════
//  Stop Recording
// ═══════════════════════════════════════════════════════════

/**
 * Stop recording a meeting and return all recording data.
 * Disconnects from VC, finalizes all streams, returns segment metadata.
 * 
 * @param {string} meetingId
 * @param {Object} [options={}] - Options including silent mode
 * @returns {Promise<Object|null>}
 */
async function stopRecording(meetingId, options = {}) {
	const session = activeRecordings.get(meetingId);
	if (!session) {
		if (!options.silent) {
			console.warn(`[RECORDING] No active recording for meeting ${meetingId}`);
		}
		return null;
	}

	if (!options.silent) {
		console.log(`[RECORDING] Stopping recording for meeting ${meetingId}...`);
	}
	const endTime = Date.now();

	// Finalize all user streams
	for (const [, userRecording] of session.users) {
		if (userRecording.currentStream && !userRecording.currentStream.destroyed) {
			userRecording.currentStream.destroy();
			userRecording.currentStream = null;
		}
		if (userRecording.currentFileStream && !userRecording.currentFileStream.destroyed) {
			userRecording.currentFileStream.end();
			userRecording.currentFileStream = null;
		}
		for (const segment of userRecording.segments) {
			if (!segment.endedAt) segment.endedAt = endTime;
		}
	}

	// Finalize any ongoing speaking events
	if (session.speakingStates && session.speakingStates.size > 0) {
		for (const [userId, startTime] of session.speakingStates) {
			const userRecording = session.users.get(userId);
			if (userRecording) {
				session.speakingTimeline.push({
					userId,
					displayName: userRecording.displayName,
					startTime,
					endTime
				});
			}
		}
		session.speakingStates.clear();
	}

	// Stop text collector
	const textMessages = session.textCollector.stop();

	// Disconnect from VC
	try {
		session.connection.destroy();
	} catch (err) {
		if (!options.silent) {
			console.warn(`[RECORDING] Error disconnecting:`, err.message);
		}
	}

	// Build return data
	const segments = [];
	const speakers = new Map();

	for (const [userId, userRecording] of session.users) {
		const validSegments = userRecording.segments.filter(seg => {
			try {
				return fs.existsSync(seg.file) && fs.statSync(seg.file).size > 500;
			} catch {
				return false;
			}
		});

		if (validSegments.length > 0) {
			segments.push({
				userId,
				displayName: userRecording.displayName,
				segments: validSegments,
			});
			speakers.set(userId, userRecording.displayName);
		}
	}

	activeRecordings.delete(meetingId);

	const result = {
		segments,
		speakers,
		textMessages,
		startTime: session.startTime,
		endTime,
		meetingDir: session.meetingDir,
		speakingTimeline: session.speakingTimeline || [],
	};

	// Save metadata on shutdown
	if (options.shutdown) {
		try {
			const speakersObj = {};
			for (const [userId, displayName] of speakers) {
				speakersObj[userId] = displayName;
			}
			const metadata = {
				segments,
				speakers: speakersObj,
				textMessages,
				startTime: session.startTime,
				endTime,
				meetingDir: session.meetingDir,
				speakingTimeline: session.speakingTimeline || [],
				consentedUsers: Array.from(session.consentedUsers || []),
				hasPlayedConsentAudio: session.hasPlayedConsentAudio || false,
				isRecordingActive: session.isRecordingActive || false,
			};
			const metadataPath = path.join(session.meetingDir, 'metadata.json');
			fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
			console.log(`[RECORDING] Saved shutdown metadata to ${metadataPath}`);
		} catch (err) {
			console.error(`[RECORDING] Failed to save shutdown metadata:`, err.message);
		}
	}

	// Release the listener client if allocated
	listenerManager.releaseListener(meetingId);

	if (!options.silent) {
		console.log(`[RECORDING] ✅ Stopped: ${segments.length} users, ${textMessages.length} texts, ${Math.round((endTime - session.startTime) / 1000)}s`);
	}
	return result;
}

// ═══════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════

/** Check if a meeting is currently being recorded. */
function isRecording(meetingId) {
	return activeRecordings.has(meetingId);
}

/** Get the meeting ID for a given channel ID, if recording. */
function getMeetingIdByChannel(channelId) {
	for (const [meetingId, session] of activeRecordings) {
		if (session.channelId === channelId) return meetingId;
	}
	return null;
}

/** Get all active recordings. */
function getActiveRecordings() {
	return activeRecordings;
}

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

function setupSpeakingReceiver(session) {
	const receiver = session.connection.receiver;

	receiver.speaking.on('start', async (userId) => {
		if (!activeRecordings.has(session.meetingId)) return;
		const sess = activeRecordings.get(session.meetingId);
		if (!sess.isRecordingActive) return;
		
		if (!sess.users.has(userId)) {
			try {
				const mainGuildObj = sess.mainClient.guilds.cache.get(sess.guildId);
				let member = mainGuildObj?.members.cache.get(userId);
				if (!member && mainGuildObj) {
					member = await mainGuildObj.members.fetch(userId).catch(() => null);
				}
				if (member && !member.user.bot) {
					subscribeToUser(sess, userId, member.displayName);
				}
			} catch (err) {
				console.warn(`[RECORDING] Failed to resolve speaker ${userId}:`, err.message);
			}
		}

		if (!sess.speakingStates.has(userId)) {
			sess.speakingStates.set(userId, Date.now());
		}
	});

	receiver.speaking.on('end', (userId) => {
		if (!activeRecordings.has(session.meetingId)) return;
		const sess = activeRecordings.get(session.meetingId);
		if (!sess.isRecordingActive) return;

		const startTime = sess.speakingStates.get(userId);
		if (startTime) {
			sess.speakingStates.delete(userId);
			const userRecording = sess.users.get(userId);
			if (userRecording) {
				sess.speakingTimeline.push({
					userId,
					displayName: userRecording.displayName,
					startTime,
					endTime: Date.now()
				});
			}
		}
	});
}

function setupDisconnectHandler(connection, meetingId) {
	connection.on(VoiceConnectionStatus.Disconnected, async () => {
		try {
			await Promise.race([
				entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
				entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
			]);
			console.log(`[RECORDING] Reconnecting for meeting ${meetingId}...`);
		} catch {
			console.warn(`[RECORDING] Connection lost for meeting ${meetingId}`);
			if (activeRecordings.has(meetingId) && connection.state.status !== VoiceConnectionStatus.Destroyed) {
				try {
					connection.destroy();
				} catch (destroyErr) {
					console.warn(`[RECORDING] Error destroying connection:`, destroyErr.message);
				}
			}
		}
	});
}

function saveMetadata(meetingId) {
	const session = activeRecordings.get(meetingId);
	if (!session) return;

	try {
		const segments = [];
		const speakersObj = {};

		for (const [userId, userRecording] of session.users) {
			const validSegments = userRecording.segments.filter(seg => {
				try {
					return fs.existsSync(seg.file) && fs.statSync(seg.file).size > 500;
				} catch {
					return false;
				}
			});

			if (validSegments.length > 0) {
				segments.push({
					userId,
					displayName: userRecording.displayName,
					segments: validSegments,
				});
				speakersObj[userId] = userRecording.displayName;
			}
		}

		const textMessages = session.textCollector ? session.textCollector.messages : [];

		const metadata = {
			segments,
			speakers: speakersObj,
			textMessages,
			startTime: session.startTime,
			endTime: Date.now(),
			meetingDir: session.meetingDir,
			speakingTimeline: session.speakingTimeline || [],
			consentedUsers: Array.from(session.consentedUsers || []),
			hasPlayedConsentAudio: session.hasPlayedConsentAudio || false,
			isRecordingActive: true,
		};

		const metadataPath = path.join(session.meetingDir, 'metadata.json');
		fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
	} catch (err) {
		console.error(`[RECORDING] Failed to auto-save metadata for ${meetingId}:`, err.message);
	}
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
	startRecording,
	stopRecording,
	isRecording,
	handleUserJoin,
	handleUserLeave,
	handleConsentButton,
	getActiveRecordings,
	getMeetingIdByChannel,
	playHindiConsent,
};
