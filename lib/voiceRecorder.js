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

// ═══════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════

/** @type {Map<string, RecordingSession>} meetingId → session */
const activeRecordings = new Map();

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
async function startRecording(voiceChannel, meetingId, client) {
	if (activeRecordings.has(meetingId)) {
		console.warn(`[RECORDING] Already recording meeting ${meetingId}`);
		return;
	}

	// Check concurrent recording limit
	const maxConcurrent = config.RECORDING?.maxConcurrentRecordings || 3;
	if (activeRecordings.size >= maxConcurrent) {
		console.warn(`[RECORDING] Max concurrent recordings (${maxConcurrent}) reached. Skipping meeting ${meetingId}`);
		return;
	}

	// Check if already recording in the same guild (Discord limit: 1 VC connection per guild)
	for (const activeSession of activeRecordings.values()) {
		if (activeSession.guildId === voiceChannel.guild.id) {
			console.warn(`[RECORDING] Already recording in guild ${voiceChannel.guild.id} (channel ${activeSession.channelId}). Cannot join another VC.`);
			return;
		}
	}

	// Create temp directory
	const baseDir = config.RECORDING?.tempDir || path.join(os.tmpdir(), 'bnb-recordings');
	const meetingDir = path.join(baseDir, meetingId);
	fs.mkdirSync(meetingDir, { recursive: true });

	console.log(`[RECORDING] Joining VC "${voiceChannel.name}" for meeting ${meetingId}`);

	// Join the voice channel
	const connection = joinVoiceChannel({
		channelId: voiceChannel.id,
		guildId: voiceChannel.guild.id,
		adapterCreator: voiceChannel.guild.voiceAdapterCreator,
		selfDeaf: false,
		selfMute: true,
	});

	try {
		await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
		console.log(`[RECORDING] Connected to VC for meeting ${meetingId}`);
	} catch (err) {
		console.error(`[RECORDING] Failed to connect for meeting ${meetingId}:`, err.message);
		connection.destroy();
		return;
	}

	// Create text collector for VC chat with playHindiConsent callback
	const textCollector = new VcTextCollector(voiceChannel.id, client, async (cmd) => {
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
		client,
		channelId: voiceChannel.id,
		guildId: voiceChannel.guild.id,
		consentedUsers: new Set(), // Track who has been shown consent
		hasPlayedConsentAudio: false, // Track if English TTS has played
		isRecordingActive: false, // Track whether recording has actually started
	};
	activeRecordings.set(meetingId, session);

	// ── Step 1: Send consent text in VC chat with Hindi button (individually for each user) ──
	const presentMembers = [...voiceChannel.members.values()].filter(m => !m.user.bot);
	for (const member of presentMembers) {
		session.consentedUsers.add(member.id);
		await sendIndividualConsent(voiceChannel, member, meetingId).catch(err => {
			console.warn(`[RECORDING] Could not send consent message to ${member.displayName}: ${err.message}`);
		});
		await sleep(200); // Small delay to avoid Discord rate limit spikes
	}

	// ── Step 2: Check if we have at least 2 people to start recording immediately ──
	if (presentMembers.length >= 2) {
		session.isRecordingActive = true;
		session.startTime = Date.now(); // Start meeting clock at actual voice start
		session.hasPlayedConsentAudio = true;
		
		// Play English TTS
		await playConsentAudio(connection).catch(err => {
			console.warn(`[RECORDING] Consent audio playback issue: ${err.message}`);
		});

		// Subscribe to all present members
		for (const member of presentMembers) {
			subscribeToUser(session, member.id, member.displayName);
		}
	}

	// ── Step 3: Setup dynamic speaking receiver listener ──
	const receiver = connection.receiver;

	// Auto-subscribe when new speakers are detected
	receiver.speaking.on('start', (userId) => {
		if (!activeRecordings.has(meetingId)) return;
		const sess = activeRecordings.get(meetingId);
		if (!sess.isRecordingActive) return; // Ignore speaking events if recording is inactive
		if (sess.users.has(userId)) return;

		const guild = client.guilds.cache.get(voiceChannel.guild.id);
		const member = guild?.members.cache.get(userId);
		if (member && !member.user.bot) {
			subscribeToUser(sess, userId, member.displayName);
		}
	});

	// Handle disconnection / reconnection
	connection.on(VoiceConnectionStatus.Disconnected, async () => {
		try {
			await Promise.race([
				entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
				entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
			]);
			console.log(`[RECORDING] Reconnecting for meeting ${meetingId}...`);
		} catch {
			console.warn(`[RECORDING] Connection lost for meeting ${meetingId}`);
			if (activeRecordings.has(meetingId)) {
				connection.destroy();
			}
		}
	});

	console.log(`[RECORDING] ✅ Recording started for meeting ${meetingId} with ${session.users.size} users`);
}

// ═══════════════════════════════════════════════════════════
//  Consent System
// ═══════════════════════════════════════════════════════════

/**
 * Play consent TTS audio files: English first, then Hindi.
 * Unmutes the bot temporarily to play audio, then re-mutes.
 */
async function playConsentAudio(connection) {
	const consent = config.RECORDING?.consent || {};
	const enFile = path.resolve(consent.audioEnglish || './assets/english.mp3');

	if (!fs.existsSync(enFile)) {
		console.log(`[RECORDING] Consent audio file not found at ${enFile} — skipping TTS playback`);
		return;
	}

	console.log(`[RECORDING] Playing English consent audio notice`);
	const player = createAudioPlayer();
	connection.subscribe(player);

	await new Promise((resolve) => {
		const resource = createAudioResource(enFile);
		player.play(resource);

		const timeout = setTimeout(() => {
			player.stop();
			resolve();
		}, 30_000); // 30s max

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
	const player = createAudioPlayer();
	session.connection.subscribe(player);

	return new Promise((resolve) => {
		const resource = createAudioResource(hiFile);
		player.play(resource);

		const timeout = setTimeout(() => {
			player.stop();
			resolve(true);
		}, 30_000); // 30s max

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
function handleUserJoin(meetingId, member) {
	const session = activeRecordings.get(meetingId);
	if (!session || member.user.bot) return;

	console.log(`[RECORDING] User ${member.displayName} joined meeting ${meetingId}`);

	const channel = member.guild.channels.cache.get(session.channelId);
	const presentMembers = channel ? [...channel.members.values()].filter(m => !m.user.bot) : [];

	// If recording is not active yet, check if we hit the 2-person threshold
	if (!session.isRecordingActive) {
		if (presentMembers.length >= 2) {
			session.isRecordingActive = true;
			session.startTime = Date.now(); // Reset start time to actual meeting start!
			session.hasPlayedConsentAudio = true;

			// Play English TTS
			playConsentAudio(session.connection).catch(err => {
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
function handleUserLeave(meetingId, member) {
	const session = activeRecordings.get(meetingId);
	if (!session || member.user.bot) return;

	const userRecording = session.users.get(member.id);
	if (!userRecording) return;

	console.log(`[RECORDING] User ${member.displayName} left meeting ${meetingId} — finalizing segment`);

	if (userRecording.currentStream && !userRecording.currentStream.destroyed) {
		userRecording.currentStream.destroy();
		userRecording.currentStream = null;
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
 * @returns {Promise<Object|null>}
 */
async function stopRecording(meetingId) {
	const session = activeRecordings.get(meetingId);
	if (!session) {
		console.warn(`[RECORDING] No active recording for meeting ${meetingId}`);
		return null;
	}

	console.log(`[RECORDING] Stopping recording for meeting ${meetingId}...`);
	const endTime = Date.now();

	// Finalize all user streams
	for (const [, userRecording] of session.users) {
		if (userRecording.currentStream && !userRecording.currentStream.destroyed) {
			userRecording.currentStream.destroy();
			userRecording.currentStream = null;
		}
		for (const segment of userRecording.segments) {
			if (!segment.endedAt) segment.endedAt = endTime;
		}
	}

	// Stop text collector
	const textMessages = session.textCollector.stop();

	// Disconnect from VC
	try {
		session.connection.destroy();
	} catch (err) {
		console.warn(`[RECORDING] Error disconnecting:`, err.message);
	}

	// Build return data
	const segments = [];
	const speakers = new Map();

	for (const [userId, userRecording] of session.users) {
		const validSegments = userRecording.segments.filter(seg => {
			try {
				return fs.existsSync(seg.file) && fs.statSync(seg.file).size > 0;
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
	};

	console.log(`[RECORDING] ✅ Stopped: ${segments.length} users, ${textMessages.length} texts, ${Math.round((endTime - session.startTime) / 1000)}s`);
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
