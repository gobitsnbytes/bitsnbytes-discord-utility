const { Events } = require('discord.js');
const notion = require('../lib/notion');
const { syncForkPermissions } = require('../lib/channelSync');
const logger = require('../lib/logger');

module.exports = {
	name: Events.GuildMemberUpdate,
	async execute(oldMember, newMember) {
		// Detect role changes
		const oldRoles = oldMember.roles.cache;
		const newRoles = newMember.roles.cache;

		// Check if any role was added or removed
		const addedRoles = newRoles.filter(r => !oldRoles.has(r.id));
		const removedRoles = oldRoles.filter(r => !newRoles.has(r.id));

		if (addedRoles.size === 0 && removedRoles.size === 0) return;

		try {
			// Fetch active forks to see if any role name matches a city name
			const forks = await notion.getForks();
			const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

			for (const fork of activeForks) {
				const city = notion.getCityName(fork);
				if (!city || city === 'UNKNOWN') continue;

				const matchesCity = (role) => role.name.toLowerCase() === city.toLowerCase();

				const isCityRoleAffected = addedRoles.some(matchesCity) || removedRoles.some(matchesCity);
				
				if (isCityRoleAffected) {
					logger.info(`[ROLE_CHANGE] Member <@${newMember.id}> city role changed for ${city}. Syncing channel...`);
					await syncForkPermissions(newMember.client, fork);
				}
			}
		} catch (err) {
			logger.error('[ROLE_CHANGE] Error during guildMemberUpdate handling:', err);
		}
	}
};
