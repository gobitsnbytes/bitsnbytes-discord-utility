const { PermissionFlagsBits, ChannelType } = require('discord.js');
const notion = require('./notion');
const logger = require('./logger');
const config = require('../config');

/**
 * Ensures global track roles, the HQ role, and track council channels exist in a guild.
 * - HQ role: manually assigned to Bits&Bytes Foundation (core team). Gold, hoisted.
 * - Track roles: auto-synced to fork team members based on their Notion role.
 * - City/contributor-city roles: auto-synced per active fork.
 * @param {Guild} guild - The Discord guild
 * @param {Role} staffRole - The Staff role
 */
async function ensureTrackRolesAndChannels(guild, staffRole) {
	const trackRolesToEnsure = [
		// 🏛️ Foundation identity role — manually assigned to HQ / core team members
		{ name: 'hq', color: '#f1c40f', hoist: true },
		// 🎯 Track contributor roles — auto-synced from Notion fork team data
		{ name: 'tech', color: '#3498db', hoist: true },
		{ name: 'creative', color: '#e91e63', hoist: true },
		{ name: 'ops', color: '#2ecc71', hoist: true },
		{ name: 'outreach', color: '#e67e22', hoist: true, id: '1509224752747909351' },
		// 🏅 Track lead roles — auto-synced from Notion fork team data
		{ name: 'tech-lead', color: '#1f8b4c', hoist: true },
		{ name: 'creative-lead', color: '#ad1457', hoist: true },
		{ name: 'ops-lead', color: '#11806a', hoist: true },
		{ name: 'outreach-lead', color: '#a84300', hoist: true, id: '1509224762906247178' }
	];

	const globalRoles = {};
	for (const roleConf of trackRolesToEnsure) {
		let role = null;
		if (roleConf.id) {
			role = guild.roles.cache.get(roleConf.id);
		}
		if (!role) {
			role = guild.roles.cache.find(r => r.name.toLowerCase() === roleConf.name);
		}
		if (!role && roleConf.name === 'creative') {
			// Fallback check for design role
			role = guild.roles.cache.find(r => r.name.toLowerCase() === 'design');
			if (role) {
				try {
					logger.info(`[SYNC] Renaming role "design" to "creative"...`);
					await role.setName('creative', 'Role realignment: design to creative');
				} catch (err) {
					logger.error(`[SYNC] Failed to rename design role to creative:`, err.message);
				}
			}
		}
		if (!role) {
			try {
				logger.info(`[SYNC] Global role "${roleConf.name}" not found. Creating...`);
				role = await guild.roles.create({
					name: roleConf.name,
					color: roleConf.color,
					hoist: roleConf.hoist,
					reason: `Automated sync: Missing global track role`
				});
			} catch (err) {
				logger.error(`[SYNC] Failed to create global role "${roleConf.name}":`, err.message);
			}
		}
		globalRoles[roleConf.name] = role;
	}

	// Ensure council channels
	const TEAM_CATEGORY_ID = '1490416956430614611';
	const category = (guild.channels.cache.get && typeof guild.channels.cache.get === 'function' ? guild.channels.cache.get(TEAM_CATEGORY_ID) : null) || 
					guild.channels.cache.find(c => c.name.toUpperCase() === 'TEAM' && c.type === ChannelType.GuildCategory);

	const councilChannelsToEnsure = [
		{ name: 'fork-dev-council', leadRoleName: 'tech-lead' },
		{ name: 'fork-creative-council', leadRoleName: 'creative-lead' },
		{ name: 'fork-ops-council', leadRoleName: 'ops-lead' },
		{ name: 'fork-outreach-council', leadRoleName: 'outreach-lead' }
	];

	const contributorRole = guild.roles.cache.get(config.ROLE_IDS.contributor) || 
							guild.roles.cache.find(r => r.name.toLowerCase() === 'builder') ||
							guild.roles.cache.find(r => r.name.toLowerCase() === 'contributor');
	const builderRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'builder');

	for (const chConf of councilChannelsToEnsure) {
		let channel = guild.channels.cache.find(c => c.name === chConf.name);
		const leadRole = globalRoles[chConf.leadRoleName];
		const overwrites = [
			{
				id: guild.roles.everyone.id,
				deny: [PermissionFlagsBits.ViewChannel],
				type: 0 // Role
			}
		];

		if (contributorRole) {
			overwrites.push({
				id: contributorRole.id,
				deny: [PermissionFlagsBits.ViewChannel],
				type: 0 // Role
			});
		}

		if (builderRole) {
			overwrites.push({
				id: builderRole.id,
				deny: [PermissionFlagsBits.ViewChannel],
				type: 0 // Role
			});
		}

		if (leadRole) {
			overwrites.push({
				id: leadRole.id,
				allow: [
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.SendMessages,
					PermissionFlagsBits.EmbedLinks,
					PermissionFlagsBits.AttachFiles,
					PermissionFlagsBits.ReadMessageHistory
				],
				type: 0 // Role
			});
		}

		const { getCoreAdminRoles } = require('./auth');
		const adminRoles = getCoreAdminRoles(guild);
		for (const adminRole of adminRoles) {
			overwrites.push({
				id: adminRole.id,
				allow: [
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.SendMessages,
					PermissionFlagsBits.EmbedLinks,
					PermissionFlagsBits.AttachFiles,
					PermissionFlagsBits.ReadMessageHistory,
					PermissionFlagsBits.ManageMessages
				],
				type: 0 // Role
			});
		}

		if (!channel) {
			logger.info(`[SYNC] Council channel #${chConf.name} not found. Creating...`);
			try {
				channel = await guild.channels.create({
					name: chConf.name,
					type: ChannelType.GuildText,
					parent: category ? category.id : null,
					permissionOverwrites: overwrites,
					reason: `Automated sync: Missing council channel`
				});
			} catch (err) {
				logger.error(`[SYNC] Failed to create council channel #${chConf.name}:`, err.message);
			}
		} else {
			// Proactively update/heal permissions of existing channel to prevent leaks
			try {
				await channel.permissionOverwrites.set(overwrites, 'Self-healing council channel permission sync');
			} catch (err) {
				logger.error(`[SYNC] Failed to set permissions for council channel #${chConf.name}:`, err.message);
			}
		}
	}

	// Ensure creative role has access to channel 1490416132262203533
	const creativeRole = globalRoles['creative'];
	if (creativeRole) {
		const targetChannelId = '1490416132262203533';
		try {
			const targetChannel = await guild.channels.fetch(targetChannelId).catch(() => null);
			if (targetChannel) {
				await targetChannel.permissionOverwrites.edit(creativeRole.id, {
					ViewChannel: true,
					SendMessages: true,
					EmbedLinks: true,
					AttachFiles: true,
					ReadMessageHistory: true
				}, { reason: 'Allow creative role access to channel 1490416132262203533' });
				logger.info(`[SYNC] Configured access to channel ${targetChannelId} for creative role.`);
			} else {
				logger.warn(`[SYNC] Channel ${targetChannelId} not found in guild.`);
			}
		} catch (err) {
			logger.error(`[SYNC] Failed to configure permissions for channel ${targetChannelId}:`, err.message);
		}
	}

	// Restrict track roles to staff and contributors
	await guild.members.fetch().catch(() => {});
	const { isStaff } = require('./auth');
	const trackRoleNames = ['tech', 'creative', 'ops', 'outreach', 'tech-lead', 'creative-lead', 'ops-lead', 'outreach-lead'];

	for (const roleName of trackRoleNames) {
		const trackRole = globalRoles[roleName];
		if (trackRole) {
			const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(trackRole.id));
			for (const [memberId, memberObj] of membersWithRole) {
				const hasContributorRole = contributorRole && memberObj.roles.cache.has(contributorRole.id);
				const isStaffMember = isStaff(memberObj, guild);
				
				if (!isStaffMember && !hasContributorRole) {
					logger.info(`[SYNC] Removing track role "${roleName}" from non-staff/non-contributor user <@${memberId}>`);
					await memberObj.roles.remove(trackRole, 'Access control: track roles are restricted to staff and contributors').catch(err => {
						logger.error(`[SYNC] Failed to remove track role "${roleName}" from <@${memberId}>:`, err.message);
					});
				}
			}
		}
	}

	return globalRoles;
}

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

		// 1. Ensure the City Roles exist in the guild
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

		let contributorCityRole = guild.roles.cache.find(r => r.name.toLowerCase() === `contributor-${city.toLowerCase()}`);
		if (!contributorCityRole) {
			try {
				logger.info(`[SYNC] Contributor city role for "contributor-${city}" not found. Creating...`);
				contributorCityRole = await guild.roles.create({
					name: `contributor-${city}`,
					reason: `Automated sync: Missing contributor city role for active fork ${city}`
				});
			} catch (err) {
				logger.error(`[SYNC] Failed to create contributor city role "contributor-${city}":`, err.message);
			}
		}

		let contributorRole = guild.roles.cache.get(config.ROLE_IDS.contributor) || 
							  guild.roles.cache.find(r => r.name.toLowerCase() === 'builder') ||
							  guild.roles.cache.find(r => r.name.toLowerCase() === 'contributor');
		if (!contributorRole) {
			try {
				logger.info(`[SYNC] Contributor role "contributor" not found. Creating...`);
				contributorRole = await guild.roles.create({
					name: 'contributor',
					reason: `Automated sync: Missing general contributor role`
				});
			} catch (err) {
				logger.error(`[SYNC] Failed to create contributor role:`, err.message);
			}
		}

		// Ensure member cache is loaded
		await guild.members.fetch().catch(() => {});

		const globalRoles = await ensureTrackRolesAndChannels(guild, staffRole);

		// 2. Ensure the Fork Lead has the @fork-lead, contributor, contributor-city, and city roles assigned
		if (leadDiscordId && cityRole && contributorCityRole && contributorRole) {
			try {
				const leadMember = guild.members.cache.get(leadDiscordId);
				if (leadMember) {
					const hasForkLead = forkLeadRole ? leadMember.roles.cache.has(forkLeadRole.id) : false;
					const hasCityRole = leadMember.roles.cache.has(cityRole.id);
					const hasContribCityRole = leadMember.roles.cache.has(contributorCityRole.id);
					const hasContributor = leadMember.roles.cache.has(contributorRole.id);

					if (forkLeadRole && !hasForkLead) {
						await leadMember.roles.add(forkLeadRole).catch(err => {
							logger.warn(`[SYNC] Failed to assign @fork-lead role to lead: ${err.message}`);
						});
					}
					if (!hasCityRole) {
						await leadMember.roles.add(cityRole).catch(err => {
							logger.warn(`[SYNC] Failed to assign city role to lead: ${err.message}`);
						});
					}
					if (!hasContribCityRole) {
						await leadMember.roles.add(contributorCityRole).catch(err => {
							logger.warn(`[SYNC] Failed to assign contributor-city role to lead: ${err.message}`);
						});
					}
					if (contributorRole && !hasContributor) {
						await leadMember.roles.add(contributorRole).catch(err => {
							logger.warn(`[SYNC] Failed to assign contributor role to lead: ${err.message}`);
						});
					}
				}
			} catch (err) {
				logger.error(`[SYNC] Failed to assign roles to lead <@${leadDiscordId}>:`, err.message);
			}
		}

		// Ensure all registered team members have the roles assigned
		for (const memberId of notionTeamDiscordIds) {
			if (memberId === leadDiscordId) continue;
			try {
				const memberObj = guild.members.cache.get(memberId);
				if (memberObj) {
					const hasCityRole = cityRole ? memberObj.roles.cache.has(cityRole.id) : false;
					const hasContribCityRole = contributorCityRole ? memberObj.roles.cache.has(contributorCityRole.id) : false;
					const hasContributor = contributorRole ? memberObj.roles.cache.has(contributorRole.id) : false;

					if (cityRole && !hasCityRole) {
						logger.info(`[SYNC] Team member <@${memberId}> is missing city role "${city}". Assigning...`);
						await memberObj.roles.add(cityRole).catch(err => {
							logger.warn(`[SYNC] Failed to assign city role "${city}" to team member <@${memberId}>: ${err.message}`);
						});
					}
					if (contributorCityRole && !hasContribCityRole) {
						logger.info(`[SYNC] Team member <@${memberId}> is missing contributor city role "contributor-${city}". Assigning...`);
						await memberObj.roles.add(contributorCityRole).catch(err => {
							logger.warn(`[SYNC] Failed to assign contributor city role to team member <@${memberId}>: ${err.message}`);
						});
					}
					if (contributorRole && !hasContributor) {
						logger.info(`[SYNC] Team member <@${memberId}> is missing contributor role. Assigning...`);
						await memberObj.roles.add(contributorRole).catch(err => {
							logger.warn(`[SYNC] Failed to assign contributor role to team member <@${memberId}>: ${err.message}`);
						});
					}

					// Resolve track and lead roles from Notion team members database
					const dbMember = teamMembers.find(m => m.discordId && m.discordId.replace(/\D/g, '') === memberId);
					if (dbMember && dbMember.role) {
						const roleLower = dbMember.role.toLowerCase();
						let trackName = null;
						let leadRoleName = null;

						if (roleLower.includes('tech')) {
							trackName = 'tech';
							if (roleLower.includes('lead') || roleLower.includes('head')) {
								leadRoleName = 'tech-lead';
							}
						} else if (roleLower.includes('creative') || roleLower.includes('design')) {
							trackName = 'creative';
							if (roleLower.includes('lead') || roleLower.includes('head')) {
								leadRoleName = 'creative-lead';
							}
						} else if (roleLower.includes('ops')) {
							trackName = 'ops';
							if (roleLower.includes('lead') || roleLower.includes('head')) {
								leadRoleName = 'ops-lead';
							}
						} else if (roleLower.includes('outreach')) {
							trackName = 'outreach';
							if (roleLower.includes('lead') || roleLower.includes('head')) {
								leadRoleName = 'outreach-lead';
							}
						}

						if (trackName && globalRoles[trackName]) {
							const trRole = globalRoles[trackName];
							const isStaffMember = isStaff(memberObj, guild);
							const hasContributorRole = contributorRole && memberObj.roles.cache.has(contributorRole.id);
							if (!isStaffMember && !hasContributorRole) {
								logger.info(`[SYNC] Skipping track role "${trRole.name}" assignment for non-staff/non-contributor user <@${memberId}>`);
							} else if (!memberObj.roles.cache.has(trRole.id)) {
								logger.info(`[SYNC] Team member <@${memberId}> is missing track role "${trRole.name}". Assigning...`);
								await memberObj.roles.add(trRole).catch(err => {
									logger.warn(`[SYNC] Failed to assign track role to team member: ${err.message}`);
								});
							}
						}
						if (leadRoleName && globalRoles[leadRoleName]) {
							const ldRole = globalRoles[leadRoleName];
							const isStaffMember = isStaff(memberObj, guild);
							const hasContributorRole = contributorRole && memberObj.roles.cache.has(contributorRole.id);
							if (!isStaffMember && !hasContributorRole) {
								logger.info(`[SYNC] Skipping lead role "${ldRole.name}" assignment for non-staff/non-contributor user <@${memberId}>`);
							} else if (!memberObj.roles.cache.has(ldRole.id)) {
								logger.info(`[SYNC] Team member <@${memberId}> is missing lead role "${ldRole.name}". Assigning...`);
								await memberObj.roles.add(ldRole).catch(err => {
									logger.warn(`[SYNC] Failed to assign lead role to team member: ${err.message}`);
								});
							}
						}
					}
				}
			} catch (err) {
				logger.error(`[SYNC] Failed to assign roles to team member <@${memberId}>:`, err.message);
			}
		}

		// Remove contributor city role from members who are not in the team and are not the lead/staff
		if (contributorCityRole) {
			const membersWithContribCityRole = guild.members.cache.filter(m => m.roles.cache.has(contributorCityRole.id));
			for (const [memberId, memberObj] of membersWithContribCityRole) {
				const isLead = leadDiscordId === memberId;
				const isTeamMember = notionTeamDiscordIds.has(memberId);
				const isStaffMember = isStaff(memberObj, guild);

				if (!isLead && !isTeamMember && !isStaffMember) {
					logger.info(`[SYNC] User <@${memberId}> has contributor city role "contributor-${city}" but is not in the team or lead. Removing role...`);
					await memberObj.roles.remove(contributorCityRole).catch(err => {
						logger.warn(`[SYNC] Failed to remove contributor city role "contributor-${city}" from <@${memberId}>: ${err.message}`);
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

		const { getCoreAdminAndParentRoles } = require('./auth');
		const allowedRoles = getCoreAdminAndParentRoles(guild);

		const overwrites = [
			{
				id: guild.roles.everyone.id,
				deny: [PermissionFlagsBits.ViewChannel],
				type: 0 // Role
			}
		];

		if (contributorRole) {
			overwrites.push({
				id: contributorRole.id,
				deny: [PermissionFlagsBits.ViewChannel],
				type: 0 // Role
			});
		}

		const builderRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'builder');
		if (builderRole) {
			overwrites.push({
				id: builderRole.id,
				deny: [PermissionFlagsBits.ViewChannel],
				type: 0 // Role
			});
		}

		const globalTrackRoleNames = ['tech', 'creative', 'ops', 'outreach', 'tech-lead', 'creative-lead', 'ops-lead', 'outreach-lead'];
		for (const trName of globalTrackRoleNames) {
			const trRole = globalRoles[trName];
			if (trRole) {
				overwrites.push({
					id: trRole.id,
					deny: [PermissionFlagsBits.ViewChannel],
					type: 0 // Role
				});
			}
		}

		if (contributorCityRole) {
			overwrites.push({
				id: contributorCityRole.id,
				allow: [
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.SendMessages,
					PermissionFlagsBits.EmbedLinks,
					PermissionFlagsBits.AttachFiles,
					PermissionFlagsBits.ReadMessageHistory
				],
				type: 0 // Role
			});
		}

		for (const allowedRole of allowedRoles) {
			if (contributorRole && allowedRole.id === contributorRole.id) continue;
			if (contributorCityRole && allowedRole.id === contributorCityRole.id) continue;
			if (overwrites.some(o => o.id === allowedRole.id)) continue;

			overwrites.push({
				id: allowedRole.id,
				allow: [
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.SendMessages,
					PermissionFlagsBits.EmbedLinks,
					PermissionFlagsBits.AttachFiles,
					PermissionFlagsBits.ReadMessageHistory,
					PermissionFlagsBits.ManageMessages,
					PermissionFlagsBits.ManageWebhooks
				],
				type: 0 // Role
			});
		}

		if (leadDiscordId) {
			overwrites.push({
				id: leadDiscordId,
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
