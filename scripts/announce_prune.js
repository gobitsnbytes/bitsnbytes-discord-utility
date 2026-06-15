const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
require('dotenv').config();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages
	]
});

client.once('ready', async () => {
	console.log(`[PRUNE_ANNOUNCE] Logged in as ${client.user.tag}`);
	
	try {
		console.log('[PRUNE_ANNOUNCE] Fetching active forks from Notion...');
		const forks = await notion.getForks();
		const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
		console.log(`[PRUNE_ANNOUNCE] Found ${activeForks.length} active forks.`);

		const guildId = process.env.GUILD_ID || '1480617556292272260';
		const guild = await client.guilds.fetch(guildId);
		console.log(`[PRUNE_ANNOUNCE] Loading channels for guild: ${guild.name}`);
		await guild.channels.fetch();

		let announcedCount = 0;
		let failedCount = 0;

		const embed = new EmbedBuilder()
			.setTitle(`⚠️ CHAPTER MAINTENANCE & ARCHIVE NOTICE`)
			.setDescription(`Please note that active engagement, regular operations, and consistent reporting are core requirements for all local chapters.

As part of our upcoming operational cleanup:
- **Dead, inactive, or slow forks will be pruned and archived.**
- Please ensure that your team structures are defined, weekly pulse updates are submitted via \`/pulse\`, and all planned events/reports are current in the system.

If you have any questions or require operational support, please contact the Core / HQ Team immediately.`)
			.setColor(config.COLORS.warning)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		for (const fork of activeForks) {
			const city = notion.getCityName(fork);
			if (!city || city === 'UNKNOWN') continue;

			const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;
			const channel = guild.channels.cache.find(c => c.name === channelName && c.isTextBased?.());

			if (channel) {
				try {
					console.log(`[PRUNE_ANNOUNCE] Announcing to #${channelName} for fork ${city}`);
					await channel.send({ embeds: [embed] });
					announcedCount++;
				} catch (err) {
					console.error(`[PRUNE_ANNOUNCE ERROR] Failed to send message to #${channelName}:`, err.message);
					failedCount++;
				}
			} else {
				console.log(`[PRUNE_ANNOUNCE WARNING] Channel #${channelName} not found in guild.`);
				failedCount++;
			}
		}

		console.log(`\n[PRUNE_ANNOUNCE] Finished chapter announcements. Announced: ${announcedCount}, Failed/Missing: ${failedCount}`);
		process.exit(0);
	} catch (err) {
		console.error('[PRUNE_ANNOUNCE ERROR]', err);
		process.exit(1);
	}
});

client.login(process.env.DISCORD_TOKEN);
