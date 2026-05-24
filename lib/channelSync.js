const { PermissionFlagsBits, ChannelType } = require('discord.js');
const notion = require('./notion');
const logger = require('./logger');

/**
 * Synchronize permissions for a single city fork channel in all guild caches.
 * Also ensures that corresponding city roles and channels exist, and leads are role-assigned.
 * @param {Client} client - The Discord client
 * @param {Object} fork - The Notion fork object
 */
async function syncForkPermissions(client, fork) {
	const city = notion.getCityName(fork);
	const leadDiscordId = notion.getLeadDiscordId(fork);

	if (!city || city === 'UNKNOWN') return;

	const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;

	// Fetch team members once per fork
	let teamMembers = [];
	try {
		teamMembers = await notion.getTeamMembers(fork.id);
	} catch (teamErr) {
		logger.warn(`[SYNC] Could not fetch team members for fork ${city}: ${teamErr.message}`);
	}

	const notionTeamDiscordIds = new Set(
		teamMembers
			.map(m => m.discordId ? m.discordId.replace(/\D/g, '') : null)
			.filter(Boolean)
	);
	if (leadDiscordId) notionTeamDiscordIds.add(leadDiscordId);

	for (const [, guild] of client.guilds.cache) {
		const { getForkLeadRole, getStaffRole, isStaff } = require('./auth');
		const forkLeadRole = getForkLeadRole(guild);
		const staffRole = getStaffRole(guild);

		// 1. Ensure the City Role exists in the guild
		let cityRole = guild.roles.cache.find(r => r.name.toLowerCase() === city.toLowerCase());
		if (!cityRole) {
			try {
				logger.info(`[SYNC] City role for "${city}" not found. Creating...`);
				cityRole = await guild.roles.create({
					name: city,
					reason: `Automated sync: Missing city role for active fork ${city}`
				});
			} catch (err) {
				logger.error(`[SYNC] Failed to create city role "${city}":`, err.message);
			}
		}

		// Ensure member cache is loaded
		await guild.members.fetch().catch(() => {});

		// 2. Ensure the Fork Lead has the @fork-lead and city roles assigned
		if (leadDiscordId && forkLeadRole && cityRole) {
			try {
				const leadMember = guild.members.cache.get(leadDiscordId);
				if (leadMember) {
					const hasForkLead = leadMember.roles.cache.has(forkLeadRole.id);
					const hasCityRole = leadMember.roles.cache.has(cityRole.id);

					if (!hasForkLead || !hasCityRole) {
						logger.info(`[SYNC] Lead <@${leadDiscordId}> is missing roles. Assigning...`);
						if (!hasForkLead) {
							await leadMember.roles.add(forkLeadRole).catch(err => {
								logger.warn(`[SYNC] Failed to assign @fork-lead role to lead: ${err.message}`);
							});
						}
						if (!hasCityRole) {
							await leadMember.roles.add(cityRole).catch(err => {
								logger.warn(`[SYNC] Failed to assign city role to lead: ${err.message}`);
							});
						}
					}
				}
			} catch (err) {
				logger.error(`[SYNC] Failed to assign roles to lead <@${leadDiscordId}>:`, err.message);
			}
		}

		// Ensure all registered team members have the City Role assigned
		if (cityRole) {
			for (const memberId of notionTeamDiscordIds) {
				if (memberId === leadDiscordId) continue;
				try {
					const memberObj = guild.members.cache.get(memberId);
					if (memberObj && !memberObj.roles.cache.has(cityRole.id)) {
						logger.info(`[SYNC] Team member <@${memberId}> is missing city role "${city}". Assigning...`);
						await memberObj.roles.add(cityRole).catch(err => {
							logger.warn(`[SYNC] Failed to assign city role "${city}" to team member <@${memberId}>: ${err.message}`);
						});
					}
				} catch (err) {
					logger.error(`[SYNC] Failed to assign city role to team member <@${memberId}>:`, err.message);
				}
			}
		}

		// Remove city role from members who are not in the team and are not the lead/staff
		if (cityRole) {
			const membersWithCityRole = guild.members.cache.filter(m => m.roles.cache.has(cityRole.id));
			for (const [memberId, memberObj] of membersWithCityRole) {
				const isLead = leadDiscordId === memberId;
				const isTeamMember = notionTeamDiscordIds.has(memberId);
				const isStaffMember = isStaff(memberObj, guild);

				if (!isLead && !isTeamMember && !isStaffMember) {
					logger.info(`[SYNC] User <@${memberId}> has city role "${city}" but is not in the team or lead. Removing city role...`);
					await memberObj.roles.remove(cityRole).catch(err => {
						logger.warn(`[SYNC] Failed to remove city role "${city}" from <@${memberId}>: ${err.message}`);
					});
				}
			}
		}

		// 3. Ensure the City Channel exists
		let cityChannel = guild.channels.cache.find(c => c.name === channelName);
		if (!cityChannel) {
			logger.info(`[SYNC] Channel #${channelName} not found. Creating...`);
			try {
				const category = guild.channels.cache.find(c => c.name === 'FORKS' && c.type === ChannelType.GuildCategory);
				cityChannel = await guild.channels.create({
					name: channelName,
					type: ChannelType.GuildText,
					parent: category ? category.id : null,
					reason: `Automated sync: Missing channel for active fork ${city}`
				});
			} catch (err) {
				logger.error(`[SYNC] Failed to create channel #${channelName}:`, err.message);
				continue;
			}
		}

		logger.info(`[SYNC] Synchronizing permissions for #${channelName} in guild: ${guild.name}`);

		// Filter members who have the city role
		const cityMembers = guild.members.cache.filter(member => member.roles.cache.has(cityRole.id));

		const desiredPermissions = new Map();

		for (const [memberId, memberObj] of cityMembers) {
			// Check if they have the Fork Lead role or are the registered Notion lead
			const hasForkLeadRole = forkLeadRole && memberObj.roles.highest.position >= forkLeadRole.position;
			const isLeadInNotion = leadDiscordId === memberId;

			if (hasForkLeadRole || isLeadInNotion) {
				desiredPermissions.set(memberId, { type: 'admin', memberObj });
				continue;
			}

			// Check if they are a contributor (Staff/Contributor/Team role OR registered team member in Notion)
			const hasStaffRole = isStaff(memberObj, guild);
			const hasContributorRole = memberObj.roles.cache.some(r =>
				r.name.toLowerCase() === 'contributor' ||
				r.name.toLowerCase() === 'team' ||
				r.name.toLowerCase() === 'team member'
			);
			const isRegisteredTeamMember = notionTeamDiscordIds.has(memberId);

			if (hasStaffRole || hasContributorRole || isRegisteredTeamMember) {
				desiredPermissions.set(memberId, { type: 'member', memberObj });
			}
		}

		// Rebuild overwrites list
		const overwrites = [
			{
				id: guild.roles.everyone.id,
				deny: [PermissionFlagsBits.ViewChannel],
				type: 0 // Role
			}
		];

		// Add overwrites for each desired member
		for (const [memberId, config] of desiredPermissions) {
			if (config.type === 'admin') {
				overwrites.push({
					id: memberId,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages,
						PermissionFlagsBits.EmbedLinks,
						PermissionFlagsBits.AttachFiles,
						PermissionFlagsBits.ReadMessageHistory,
						PermissionFlagsBits.ManageMessages,
						PermissionFlagsBits.ManageChannels,
						PermissionFlagsBits.ManageWebhooks
					],
					type: 1 // Member
				});
				logger.info(`[SYNC]   -> Granted Admin access to <@${memberId}>`);
			} else {
				overwrites.push({
					id: memberId,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages,
						PermissionFlagsBits.EmbedLinks,
						PermissionFlagsBits.AttachFiles,
						PermissionFlagsBits.ReadMessageHistory
					],
					type: 1 // Member
				});
				logger.info(`[SYNC]   -> Granted Member access to <@${memberId}>`);
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
