const { Client, GatewayIntentBits } = require('discord.js');
const notion = require('../lib/notion');
require('dotenv').config();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages
	]
});

client.once('ready', async () => {
	console.log(`[DELETE_PRUNE] Logged in as ${client.user.tag}`);
	
	try {
		console.log('[DELETE_PRUNE] Fetching active forks from Notion...');
		const forks = await notion.getForks();
		const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

		const guildId = process.env.GUILD_ID || '1480617556292272260';
		const guild = await client.guilds.fetch(guildId);
		await guild.channels.fetch();

		let deletedCount = 0;

		for (const fork of activeForks) {
			const city = notion.getCityName(fork);
			if (!city || city === 'UNKNOWN') continue;

			const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;
			const channel = guild.channels.cache.find(c => c.name === channelName && c.isTextBased?.());

			if (channel) {
				try {
					// Fetch last 10 messages in the channel
					const messages = await channel.messages.fetch({ limit: 10 });
					// Find the bot message with the archive warning embed
					const botMsg = messages.find(m => 
						m.author.id === client.user.id && 
						m.embeds && 
						m.embeds.some(e => e.title === '⚠️ CHAPTER MAINTENANCE & ARCHIVE NOTICE')
					);

					if (botMsg) {
						console.log(`[DELETE_PRUNE] Deleting warning message in #${channelName}`);
						await botMsg.delete();
						deletedCount++;
					}
				} catch (err) {
					console.error(`[DELETE_PRUNE ERROR] Failed to delete in #${channelName}:`, err.message);
				}
			}
		}

		console.log(`[DELETE_PRUNE] Completed. Deleted messages: ${deletedCount}`);
		process.exit(0);
	} catch (err) {
		console.error('[DELETE_PRUNE ERROR]', err);
		process.exit(1);
	}
});

client.login(process.env.DISCORD_TOKEN);
