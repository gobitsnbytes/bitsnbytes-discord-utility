const notion = require('./notion');

// Predefined Staff role IDs
const STAFF_ROLE_IDS = [
	process.env.STAFF_ROLE_ID,
	'1506019068132462804',
	'1506323726223016149',
	'1480620981587279993'
].filter(Boolean);

// Predefined Fork Lead role IDs
const FORK_LEAD_ROLE_IDS = [
	process.env.FORK_LEAD_ROLE_ID,
	'1490410901147488286'
].filter(Boolean);

/**
 * Resolves the Staff role in a given guild.
 * Checks ENV config, standard IDs, and case-insensitive fallback to "staff" name.
 */
function getStaffRole(guild) {
	if (!guild || !guild.roles) return null;
	for (const id of STAFF_ROLE_IDS) {
		const role = guild.roles.cache.get(id);
		if (role) return role;
	}
	return guild.roles.cache.find(r => r.name.toLowerCase() === 'staff') || null;
}

/**
 * Resolves the Fork Lead role in a given guild.
 * Checks ENV config, standard IDs, and case-insensitive fallback to "fork-lead"/"fork lead".
 */
function getForkLeadRole(guild) {
	if (!guild || !guild.roles) return null;
	for (const id of FORK_LEAD_ROLE_IDS) {
		const role = guild.roles.cache.get(id);
		if (role) return role;
	}
	return guild.roles.cache.find(r => r.name.toLowerCase() === 'fork-lead' || r.name.toLowerCase() === 'fork lead') || null;
}

/**
 * Checks if a member has staff privileges.
 */
function isStaff(member, guild) {
	if (!member) return false;
	if (member.permissions.has('Administrator')) return true;
	if (member.permissions.has('ManageRoles')) return true;
	
	const staffRole = getStaffRole(guild);
	if (staffRole && member.roles.cache.has(staffRole.id)) return true;
	
	// Fallback to checking other predefined staff IDs in cache directly
	for (const id of STAFF_ROLE_IDS) {
		if (member.roles.cache.has(id)) return true;
	}
	
	return false;
}

/**
 * Helper to check role hierarchy and staff status.
 * Returns true if authorized, false if not authorized, or null if it needs to fall back to city checks.
 * 
 * @param {GuildMember} member - The Discord GuildMember object
 * @param {Guild} guild - The Discord Guild object
 * @returns {boolean|null}
 */
function checkHierarchyAndStaff(member, guild) {
	if (!member) return false;

	// Admins bypass all checks
	if (member.permissions.has('Administrator')) {
		return true;
	}

	// Staff bypass all checks
	if (isStaff(member, guild)) {
		return true;
	}

	// Fork Lead role check
	const forkLeadRole = getForkLeadRole(guild);
	if (!forkLeadRole) {
		console.warn("[AUTH] 'fork-lead' role not found in the guild.");
		return false;
	}

	return null; // Fall back to city checks
}

/**
 * Checks if a member is authorized for a given city fork.
 * Authorized if:
 * 1. Has 'fork-lead' role or above in hierarchy.
 * 2. If yes, authorized if Staff/Admin OR registered lead/team member for that city.
 * 
 * @param {User} user - The Discord User to check
 * @param {string} city - The name of the city
 * @param {Guild} guild - The Discord Guild
 * @returns {Promise<boolean>}
 */
async function isAuthorizedForCity(user, city, guild) {
	if (!city || !guild) return false;

	// 1. Hierarchy & Staff check
	try {
		const member = await guild.members.fetch(user.id).catch(() => null);
		const authResult = checkHierarchyAndStaff(member, guild);
		if (authResult !== null) {
			return authResult;
		}
	} catch (err) {
		console.warn('[AUTH] Error during hierarchy check:', err.message);
	}

	// Find the fork by city
	const fork = await notion.findForkByCity(city);
	if (!fork) return false;

	// 2. Fork Lead check
	const leadDiscordId = notion.getLeadDiscordId(fork);
	if (leadDiscordId === user.id) {
		return true;
	}

	// 3. Team Member check
	try {
		const teamMember = await notion.findTeamMember(fork.id, user.id);
		if (teamMember) {
			return true;
		}
	} catch (err) {
		console.warn('[AUTH] Error during team member check:', err.message);
	}

	return false;
}

/**
 * Checks if a member is authorized for a given fork ID.
 * Same checks as isAuthorizedForCity but uses the Notion Page ID.
 * 
 * @param {User} user - The Discord User to check
 * @param {string} forkId - The Notion/SQLite fork ID
 * @param {Guild} guild - The Discord Guild
 * @returns {Promise<boolean>}
 */
async function isAuthorizedForForkId(user, forkId, guild) {
	if (!forkId || !guild) return false;

	// 1. Hierarchy & Staff check
	try {
		const member = await guild.members.fetch(user.id).catch(() => null);
		const authResult = checkHierarchyAndStaff(member, guild);
		if (authResult !== null) {
			return authResult;
		}
	} catch (err) {
		console.warn('[AUTH] Error during hierarchy check:', err.message);
	}

	// Retrieve the fork from Notion
	let fork;
	try {
		// Prefer Notion Client SDK
		if (notion && notion.pages && typeof notion.pages.retrieve === 'function') {
			fork = await notion.pages.retrieve({ page_id: forkId });
		} else {
			// SDK fallback: retrieve via REST API query
			const https = require('https');
			const options = {
				hostname: 'api.notion.com',
				port: 443,
				path: `/v1/pages/${forkId}`,
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
					'Notion-Version': process.env.NOTION_VERSION || '2022-06-28',
				},
			};
			const responseData = await new Promise((resolve, reject) => {
				const req = https.request(options, (res) => {
					let data = '';
					res.on('data', (chunk) => { data += chunk; });
					res.on('end', () => {
						try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); }
					});
				});
				req.on('error', (e) => reject(e));
				req.end();
			});
			fork = responseData;
		}
	} catch (err) {
		console.warn('[AUTH] Failed to fetch fork details from Notion:', err.message);
	}

	if (!fork || fork.object === 'error') return false;

	// 2. Fork Lead check
	const leadDiscordId = notion.getLeadDiscordId(fork);
	if (leadDiscordId === user.id) {
		return true;
	}

	// 3. Team Member check
	try {
		const teamMember = await notion.findTeamMember(forkId, user.id);
		if (teamMember) {
			return true;
		}
	} catch (err) {
		console.warn('[AUTH] Error during team member check:', err.message);
	}

	return false;
}

module.exports = {
	isAuthorizedForCity,
	isAuthorizedForForkId,
	getStaffRole,
	getForkLeadRole,
	isStaff,
};
