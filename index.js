const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
require('dotenv').config();
const logger = require('./lib/logger');

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMessageReactions,
	],
	partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Load commands
logger.boot('Initializing command loading...');
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
logger.boot(`Loaded ${client.commands.size} commands.`);

// Load events
logger.boot('Initializing event loading...');
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	try {
		const event = require(filePath);
		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
		} else {
			client.on(event.name, (...args) => event.execute(...args));
		}
		}
	} catch (err) {
		logger.error(`Failed to load event ${file}`, err);
	}
}
logger.boot(`Events hooked.`);

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
	} catch (error) {
		logger.error('Failed to register slash commands', error);
	}
});

// Initialize logger with client
logger.init(client);

// Initialize background jobs with isolated error handling
logger.boot('Initializing jobs...');

/**
 * Safely start a job module - prevents one broken job from aborting all others
 * @param {string} jobPath - Path to the job module
 * @param {Object} client - Discord client
 * @param {string} jobName - Human-readable job name for logging
 */
function safeStartJob(jobPath, client, jobName) {
	try {
		const job = require(jobPath);
		job(client);
		logger.boot(`${jobName} initialized successfully.`);
	} catch (err) {
		logger.error(`Failed to initialize ${jobName}`, err);
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

console.log('[BOOT] Job initialization complete.');

// Log in
logger.boot('Attempting login...');
client.login(process.env.DISCORD_TOKEN).catch(err => {
	logger.error('Login failed', err);
	process.exit(1);
});
