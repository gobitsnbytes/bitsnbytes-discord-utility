const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes, ActivityType } = require('discord.js');
require('dotenv').config();
const logger = require('./lib/logger');
const { getGitInfo } = require('./lib/git');
const db = require('./lib/db');
const listenerManager = require('./lib/listenerManager');

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildVoiceStates,
	],
	partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Load commands
logger.boot('Initializing command loading...', null, false);
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	try {
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			logger.warn(`The command at ${filePath} is missing "data" or "execute".`);
		}
	} catch (err) {
		logger.error(`Failed to load command ${file}`, err);
	}
}
logger.boot(`Loaded ${client.commands.size} commands.`, null, false);

// Load events
logger.boot('Initializing event loading...', null, false);
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	try {
		const event = require(filePath);
		const executeWrapper = async (...args) => {
			try {
				await event.execute(...args);
			} catch (err) {
				logger.error(`Error in event listener ${event.name}`, err);
			}
		};
		if (event.once) {
			client.once(event.name, executeWrapper);
		} else {
			client.on(event.name, executeWrapper);
		}
	} catch (err) {
		logger.error(`Failed to load event ${file}`, err);
	}
}
logger.boot('Events hooked.', null, false);

// Auto-register slash commands on startup
client.once('ready', async () => {
	console.log('[BOOT] Ready event fired, starting command registration...');
	try {
		const rest = new REST().setToken(process.env.DISCORD_TOKEN);
		const commands = [];
		for (const [, command] of client.commands) {
			commands.push(command.data.toJSON());
		}

		if (process.env.GUILD_ID) {
			const data = await rest.put(
				Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
				{ body: commands },
			);
			console.log(`[COMMANDS] Registered ${data.length} guild commands.`);
		} else {
			const data = await rest.put(
				Routes.applicationCommands(client.user.id),
				{ body: commands },
			);
			console.log(`[COMMANDS] Registered ${data.length} global commands.`);
		}

		// Log Deployment Receipt
		const gitInfo = getGitInfo();
		const jobStatus = global.jobsLoadSuccess !== false ? '✅ Jobs: Active' : '⚠️ Jobs: Load Failures';
		const stats = `✅ Commands: ${client.commands.size} Loaded\n✅ Events: Hooked\n${jobStatus}`;
		
		if (gitInfo.available) {
			logger.boot(
				`SYSTEM // PROTOCOL_ONLINE`,
				`**VERSION INFO**\n\`${gitInfo.hash}\` — *${gitInfo.title}*\n👤 **By:** ${gitInfo.author}\n\n**SYSTEM STATUS**\n${stats}`
			);
		} else {
			logger.boot(`SYSTEM // PROTOCOL_ONLINE`, `**SYSTEM STATUS**\n${stats}`);
		}

		// 🤖 Main bot booting up... Fueling on digital coffee and unresolved promises.
		// 🌌 Re-routing the main power grid from Notion to our hopes and dreams.
		try {
			const statuses = [
				{ name: 'Upstream sync (or lack thereof) // /help', type: ActivityType.Watching },
				{ name: 'Catching bugs & throwing them at devs // /help', type: ActivityType.Playing },
				{ name: 'Forks gossiping in the matrix // /help', type: ActivityType.Watching },
				{ name: 'Devs weeping over merge conflicts // /help', type: ActivityType.Listening },
				{ name: 'Staring contest with SQLite // /help', type: ActivityType.Competing },
				{ name: 'Syncing Notion (and my existential dread) // /help', type: ActivityType.Playing },
				{ name: 'Whispering sweet binaries to the mainframe // /help', type: ActivityType.Playing }
			];
			const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
			client.user.setPresence({
				activities: [randomStatus],
				status: 'online'
			});
		} catch (presErr) {
			console.warn(`[BOOT] Failed to set presence:`, presErr.message);
		}

		// Set cool bio/About Me description for the main bot
		try {
			const bio = "Official operational sync bridge for GOBITSNBYTES FOUNDATION, a Section 8 Company limited by guarantee. Coordinates Upstream workflows and the distributed bitsbytes Network of local Forks, Nodes, and Maintainers. Integrates Discord interactions, performance health scoring, gamification, and meeting recording systems.";
			if (client.application) {
				await client.application.edit({ description: bio });
				console.log(`[BOOT] Main bot application bio updated successfully. Reality successfully refactored! 🚀`);
			}
		} catch (bioErr) {
			console.warn(`[BOOT] Failed to update main bot application bio:`, bioErr.message);
		}

		// Pre-warm the listener bots pool on boot
		try {
			if (listenerManager.hasListenerTokens()) {
				logger.boot('Pre-warming listener bots pool...', null, false);
				await listenerManager.initializePool();
			}
		} catch (poolErr) {
			console.error(`[BOOT] Failed to pre-warm listener pool:`, poolErr.message);
		}

		// Self-healing / Startup Resumption
		try {
			const guildId = process.env.GUILD_ID;
			if (guildId && process.env.RECORDING_ENABLED === 'true') {
				const guild = await client.guilds.fetch(guildId).catch(() => null);
				if (guild) {
					const config = require('./config');
					const meetingsDb = require('./lib/meetingsDb');
					const { startRecording } = require('./lib/voiceRecorder');
					const { queueTranscription } = require('./lib/transcriptionPipeline');
					
					// 1. Scan DB for meetings in 'active' status
					const activeMeetings = await meetingsDb.getActiveMeetings();
					const baseDir = config.RECORDING?.tempDir || path.join(require('os').tmpdir(), 'bnb-recordings');
					
					for (const meeting of activeMeetings) {
						if (meeting.location_type === 'discord_vc' && meeting.temp_channel_id) {
							const vcChannel = await guild.channels.fetch(meeting.temp_channel_id).catch(() => null);
							const humanMembers = vcChannel ? vcChannel.members.filter(m => !m.user.bot) : null;
							
							if (vcChannel && humanMembers && humanMembers.size > 0) {
								// VC still has human members - spin up helper bot and rejoin to resume recording
								console.log(`[BOOT] Resuming recording for active meeting "${meeting.title}" (${meeting.id}) in VC`);
								await startRecording(vcChannel, meeting.id, client).catch(err => {
									console.error(`[BOOT] Failed to resume recording for active meeting ${meeting.id}:`, err.message);
								});
							} else {
								// VC is empty or deleted - conclusion of the meeting
								console.log(`[BOOT] Meeting "${meeting.title}" VC is empty/deleted on startup. Processing remaining files.`);
								
								// Scan for saved metadata.json on disk to transcribe whatever was recorded
								const meetingDir = path.join(baseDir, meeting.id);
								const metadataPath = path.join(meetingDir, 'metadata.json');
								if (fs.existsSync(metadataPath)) {
									try {
										const rawData = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
										const recordingData = {
											...rawData,
											speakers: new Map(Object.entries(rawData.speakers || {}))
										};
										console.log(`[BOOT] Reconstructed metadata.json for ${meeting.id}. Queueing transcription.`);
										await queueTranscription(meeting, recordingData, client);
									} catch (err) {
										console.error(`[BOOT] Failed to process metadata.json for meeting ${meeting.id}:`, err.message);
									}
								}
								
								// Mark meeting as completed
								await meetingsDb.updateMeetingStatus(meeting.id, 'completed').catch(() => {});
							}
						}
					}
					
					// 2. Scan temp dir for any metadata.json files of non-active meetings that ended while offline
					if (fs.existsSync(baseDir)) {
						const dirs = fs.readdirSync(baseDir);
						for (const meetingId of dirs) {
							// Skip if it was already processed above
							const isActive = activeMeetings.some(m => m.id === meetingId);
							if (isActive) continue;

							const meetingDir = path.join(baseDir, meetingId);
							const metadataPath = path.join(meetingDir, 'metadata.json');
							if (fs.existsSync(metadataPath)) {
								console.log(`[BOOT] Processing offline ended meeting recording: ${meetingId}`);
								try {
									const rawData = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
									const recordingData = {
										...rawData,
										speakers: new Map(Object.entries(rawData.speakers || {}))
									};
									
									const meeting = await meetingsDb.getMeeting(meetingId);
									if (meeting) {
										await queueTranscription(meeting, recordingData, client);
									} else {
										console.log(`[BOOT] Stale meeting ${meetingId} not found in DB. Purging files.`);
										fs.rmSync(meetingDir, { recursive: true, force: true });
									}
								} catch (err) {
									console.error(`[BOOT] Failed to process offline metadata.json for ${meetingId}:`, err.message);
								}
							}
						}
					}
				}
			}
		} catch (bootRecoveryError) {
			console.error('[BOOT] Error in startup self-healing / recovery:', bootRecoveryError.message);
		}
	} catch (error) {
		logger.error('Failed to register slash commands', error);
	}
});

// Initialize logger with client
logger.init(client);

// Initialize background jobs with isolated error handling
logger.boot('Initializing jobs...', null, false);

/**
 * Safely start a job module - prevents one broken job from aborting all others
 * @param {string} jobPath - Path to the job module
 * @param {Object} client - Discord client
 * @param {string} jobName - Human-readable job name for logging
 */
global.jobsLoadSuccess = true;

function safeStartJob(jobPath, client, jobName) {
	try {
		const job = require(jobPath);
		job(client);
		logger.boot(`${jobName} initialized successfully.`, null, false);
	} catch (err) {
		logger.error(`Failed to initialize ${jobName}`, err);
		global.jobsLoadSuccess = false;
	}
}

// Original jobs
safeStartJob('./jobs/staleCheck', client, 'staleCheck');
safeStartJob('./jobs/weeklyBrief', client, 'weeklyBrief');

// New Phase 1-3 jobs
safeStartJob('./jobs/healthWeekly', client, 'healthWeekly');
safeStartJob('./jobs/onboardingCheck', client, 'onboardingCheck');
safeStartJob('./jobs/reportReminders', client, 'reportReminders');
safeStartJob('./jobs/reminderCheck', client, 'reminderCheck');
safeStartJob('./jobs/monthlyWinner', client, 'monthlyWinner');
safeStartJob('./jobs/reportLateUpdater', client, 'reportLateUpdater');
safeStartJob('./jobs/meetingScheduler', client, 'meetingScheduler');
safeStartJob('./jobs/notionProfileCheck', client, 'notionProfileCheck');
safeStartJob('./jobs/meetingRecovery', client, 'meetingRecovery');

console.log('[BOOT] Job initialization complete.');

// Start unified scheduling and webhook server
if (process.env.CALCOM_WEBHOOK_SECRET || process.env.WEBHOOK_PORT) {
	try {
		const { startWebServer } = require('./server');
		startWebServer(client);
	} catch (webErr) {
		logger.error('Failed to initialize Web Server', webErr);
	}
}

// Log in
logger.boot('Attempting login...', null, false);
client.login(process.env.DISCORD_TOKEN).catch(err => {
	logger.error('Login failed', err);
	process.exit(1);
});

// Graceful shutdown
const handleShutdown = async () => {
	logger.boot('Shutdown signal received. Starting graceful shutdown sequence...', null, false);
	try {
		// Stop any active recordings and save their metadata.json before exiting
		const { getActiveRecordings, stopRecording } = require('./lib/voiceRecorder');
		const active = getActiveRecordings();
		if (active && active.size > 0) {
			console.log(`[SHUTDOWN] Saving state for ${active.size} active recording(s)...`);
			for (const meetingId of active.keys()) {
				try {
					await stopRecording(meetingId, { shutdown: true, silent: false });
				} catch (err) {
					console.error(`[SHUTDOWN] Failed to stop recording for ${meetingId}:`, err.message);
				}
			}
		}
	} catch (err) {
		console.error('[SHUTDOWN] Error during graceful wrap-up:', err.message);
	}

	logger.boot('Closing database connections...', null, false);
	try {
		db.close();
		logger.boot('Database connections closed successfully. Exiting.', null, false);
	} catch (err) {
		logger.error('Error closing database connections during shutdown', err);
	}
	process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
