const { PermissionFlagsBits } = require('discord.js');
const notion = require('./notion');
const logger = require('./logger');

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || '1506019068132462804';

/**
 * Synchronize permissions for a single city fork channel in all guild caches.
 * @param {Client} client - The Discord client
 * @param {Object} fork - The Notion fork object
 */
async function syncForkPermissions(client, fork) {
	const city = notion.getCityName(fork);
	const leadDiscordId = fork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;

	if (!city || city === 'UNKNOWN') return;

	const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;

	for (const [, guild] of client.guilds.cache) {
		const cityChannel = guild.channels.cache.find(c => c.name === channelName);
		if (!cityChannel) continue;

		logger.info(`[SYNC] Synchronizing permissions for #${channelName} in guild: ${guild.name}`);

		const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);

		// 1. Fetch team members to compute desired state
		let teamMembers = [];
		try {
			teamMembers = await notion.getTeamMembers(fork.id);
		} catch (teamErr) {
			logger.warn(`[SYNC] Could not fetch team members for fork ${city}: ${teamErr.message}`);
		}

		// 2. Compute the exact set of Discord IDs that should be in the channel
		const desiredIds = new Set();
		desiredIds.add(guild.roles.everyone.id);
		if (staffRole) desiredIds.add(staffRole.id);

		const cityRole = guild.roles.cache.find(r => r.name.toLowerCase() === city.toLowerCase());

		if (leadDiscordId) {
			const leadMember = await guild.members.fetch(leadDiscordId).catch(() => null);
			const hasCityRole = cityRole && leadMember && leadMember.roles.cache.has(cityRole.id);
			if (hasCityRole) {
				desiredIds.add(leadDiscordId);
			}
		}

		for (const member of teamMembers) {
			if (member.discordId) {
				const teamMemberObj = await guild.members.fetch(member.discordId).catch(() => null);
				const hasCityRole = cityRole && teamMemberObj && teamMemberObj.roles.cache.has(cityRole.id);
				if (hasCityRole) {
					desiredIds.add(member.discordId);
				}
			}
		}

		// 3. Diff against the channel's current permission overwrites
		const currentOverwrites = cityChannel.permissionOverwrites.cache;
		const currentIds = new Set(currentOverwrites.keys());

		let isMatch = desiredIds.size === currentIds.size;
		if (isMatch) {
			for (const id of desiredIds) {
				if (!currentIds.has(id)) {
					isMatch = false;
					break;
				}
			}
		}

		// 4. If they match perfectly, skip execution
		if (isMatch) {
			continue;
		}

		// 5. Mismatch detected: rebuild permissions
		logger.info(`[SYNC] Mismatch detected for #${channelName}. Rebuilding permissions...`);

		const overwrites = [
			{
				id: guild.roles.everyone.id,
				deny: [PermissionFlagsBits.ViewChannel],
				type: 0 // Role
			}
		];

		if (staffRole) {
			overwrites.push({
				id: staffRole.id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
				type: 0 // Role
			});
		}

		if (leadDiscordId && desiredIds.has(leadDiscordId)) {
			overwrites.push({
				id: leadDiscordId,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
				type: 1 // Member
			});
			logger.info(`[SYNC]   -> Granted Lead access to <@${leadDiscordId}>`);
		}

		for (const member of teamMembers) {
			if (member.discordId && desiredIds.has(member.discordId) && member.discordId !== leadDiscordId) {
				overwrites.push({
					id: member.discordId,
					allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
					type: 1 // Member
				});
				logger.info(`[SYNC]   -> Granted Team Member access to <@${member.discordId}> (${member.role})`);
			}
		}

		await cityChannel.permissionOverwrites.set(overwrites, 'Self-healing channel permission synchronization');
	}
}

/**
 * Synchronize permissions for all active forks.
 * @param {Client} client - The Discord client
 */
async function syncAllForks(client) {
	try {
		const forks = await notion.getForks();
		const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
		logger.info(`[SYNC] Found ${activeForks.length} active forks in registry.`);

		for (const fork of activeForks) {
			await syncForkPermissions(client, fork);
		}
	} catch (err) {
		logger.error('[SYNC] Self-healing synchronization failed', err);
	}
}

module.exports = {
	syncForkPermissions,
	syncAllForks,
};
