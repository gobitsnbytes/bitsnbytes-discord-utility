const { Events, EmbedBuilder } = require('discord.js');
const logger = require('../lib/logger');
const { getGitInfo } = require('../lib/git');
const { syncAllForks } = require('../lib/channelSync');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		logger.init(client); // Re-init to trigger flush now that we are ready
		logger.boot(`Logged in as ${client.user.tag}`);

		// Leave unauthorized guilds on startup
		const allowedGuildId = process.env.GUILD_ID || '1480617556292272260';
		for (const [guildId, guild] of client.guilds.cache) {
			if (guildId !== allowedGuildId) {
				logger.warn(`[SECURITY] Main bot is in unauthorized guild: ${guild.name} (${guildId}). Leaving...`);
				await guild.leave().catch(err => {
					logger.error(`[SECURITY] Failed to leave unauthorized guild ${guildId}: ${err.message}`);
				});
			}
		}

		const rolesChannel = client.channels.cache.find(c => c.name === 'roles');
		if (rolesChannel) {
			logger.info(`Found #roles channel (${rolesChannel.id}). Starting setup...`);
			try {
				// Delete old bot messages concurrently
				const messages = await rolesChannel.messages.fetch({ limit: 20 });
				const botMessages = messages.filter(m => m.author.id === client.user.id);
				logger.info(`Found ${botMessages.size} old messages to purge in #roles.`);
				await Promise.all(botMessages.map(msg => msg.delete().catch(() => { })));

				// Query Notion active forks
				const notion = require('../lib/notion');
				const forks = await notion.getForks().catch(() => []);
				const activeCities = forks
					.filter(f => f.properties?.Status?.select?.name === 'Active')
					.map(f => notion.getCityName(f))
					.filter(c => c && c !== 'UNKNOWN');

				logger.info(`Found ${activeCities.length} active cities for reaction roles: ${activeCities.join(', ')}`);

				if (activeCities.length > 0) {
					// Sort them alphabetically to be consistent
					activeCities.sort();

					const cityEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
					const cityFields = [];
					const emojiList = [];

					for (let i = 0; i < Math.min(activeCities.length, cityEmojis.length); i++) {
						const emoji = cityEmojis[i];
						const city = activeCities[i];
						cityFields.push(`${emoji} ${city}`);
						emojiList.push(emoji);
					}

					const citiesEmbed = new EmbedBuilder()
						.setTitle('📍 Pick Your City')
						.setDescription('React below to get your city community role!')
						.addFields(
							{ name: 'Active Cities', value: cityFields.join('\n') }
						)
						.setColor('#97192c');

					const sentCities = await rolesChannel.send({ embeds: [citiesEmbed] });

					logger.info('Posting city reactions to #roles...');
					// React sequentially to prevent API rate limiting
					for (const emoji of emojiList) {
						await sentCities.react(emoji).catch(() => {});
					}
				}

				logger.info('Channel setup successful.');
			} catch (err) {
				logger.error('Roles setup failed', err);
			}
		} else {
			logger.warn('#roles channel not found.');
		}

		// ⌬ Self-Healing Channel Permission Synchronization for Active Forks
		logger.info('Starting self-healing channel permission synchronization...');
		await syncAllForks(client);
		logger.info('Self-healing permission synchronization complete.');
	},
};
