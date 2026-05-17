/**
 * 🛡️ PROTOCOL AUTHORIZATION LAYER
 * Handles access control checks for fork-specific commands.
 */

const notion = require('./notion');
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || '1480620981587279993';

/**
 * Checks if a member is authorized for a given city fork.
 * Authorized if:
 * 1. Staff role or ManageRoles / Administrator permission.
 * 2. Fork Lead for the city (stored in Notion).
 * 3. Registered Team Member for the city (stored in SQLite).
 * 
 * @param {User} user - The Discord User to check
 * @param {string} city - The name of the city
 * @param {Guild} guild - The Discord Guild
 * @returns {Promise<boolean>}
 */
async function isAuthorizedForCity(user, city, guild) {
	if (!city || !guild) return false;

	// 1. Staff and Admin check
	try {
		const member = await guild.members.fetch(user.id).catch(() => null);
		if (member) {
			if (member.roles.cache.has(STAFF_ROLE_ID) || member.permissions.has('ManageRoles') || member.permissions.has('Administrator')) {
				return true;
			}
		}
	} catch (err) {
		console.warn('[AUTH] Error during staff check:', err.message);
	}

	// Find the fork by city
	const fork = await notion.findForkByCity(city);
	if (!fork) return false;

	// 2. Fork Lead check
	const leadDiscordId = fork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
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

	// 1. Staff and Admin check
	try {
		const member = await guild.members.fetch(user.id).catch(() => null);
		if (member) {
			if (member.roles.cache.has(STAFF_ROLE_ID) || member.permissions.has('ManageRoles') || member.permissions.has('Administrator')) {
				return true;
			}
		}
	} catch (err) {
		console.warn('[AUTH] Error during staff check:', err.message);
	}

	// Retrieve the fork from Notion
	let fork;
	try {
		// Prefer Notion Client SDK
		if (notion && notion.pages && typeof notion.pages.retrieve === 'function') {
			fork = await notion.pages.retrieve({ page_id: forkId }).catch(() => null);
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
	const leadDiscordId = fork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
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
};
