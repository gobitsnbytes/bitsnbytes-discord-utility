const { Events } = require('discord.js');
const logger = require('../lib/logger');

module.exports = {
	name: Events.GuildCreate,
	once: false,
	async execute(guild) {
		const allowedId = process.env.GUILD_ID || '1480617556292272260';
		if (guild.id !== allowedId) {
			logger.warn(`[SECURITY] Main bot was invited to unauthorized guild: ${guild.name} (${guild.id}). Leaving immediately...`);
			await guild.leave().catch(err => {
				logger.error(`[SECURITY] Failed to leave unauthorized guild ${guild.id}: ${err.message}`);
			});
		}
	},
};
