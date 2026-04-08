const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
require('dotenv').config();

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
console.log('[BOOT] Initializing command loading...');
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
			console.log(`[WARNING] The command at ${filePath} is missing "data" or "execute".`);
		}
	} catch (err) {
		console.error(`[BOOT ERROR] Failed to load command ${file}:`, err.message);
	}
}
console.log(`[BOOT] Loaded ${client.commands.size} commands.`);

// Load events
console.log('[BOOT] Initializing event loading...');
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
	} catch (err) {
		console.error(`[BOOT ERROR] Failed to load event ${file}:`, err.message);
	}
}
console.log(`[BOOT] Events hooked.`);

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
		console.error('[COMMANDS ERROR] Failed to register:', error);
	}
});

// Initialize background jobs
console.log('[BOOT] Initializing jobs...');
try {
	const staleCheck = require('./jobs/staleCheck');
	staleCheck(client);
} catch (err) {
	console.error('[BOOT ERROR] Failed to initialize staleCheck:', err.message);
}

// Log in
console.log('[BOOT] Attempting login...');
client.login(process.env.DISCORD_TOKEN).catch(err => {
	console.error('[BOOT ERROR] Login failed:', err.message);
	process.exit(1);
});
