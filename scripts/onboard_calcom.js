const { Client, GatewayIntentBits } = require('discord.js');
const notion = require('../lib/notion');
const db = require('../lib/db');
require('dotenv').config();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers
	]
});

client.once('ready', async () => {
	console.log(`[ONBOARD] Logged in as ${client.user.tag}`);
	
	try {
		console.log('[ONBOARD] Fetching active forks from Notion...');
		const forks = await notion.getForks();
		const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
		console.log(`[ONBOARD] Found ${activeForks.length} active forks.`);

		const guildId = process.env.GUILD_ID || '1480617556292272260';
		const guild = await client.guilds.fetch(guildId);
		console.log(`[ONBOARD] Fetching all members for guild: ${guild.name}`);
		await guild.members.fetch();

		for (const fork of activeForks) {
			const city = notion.getCityName(fork);
			if (!city || city === 'UNKNOWN') continue;

			console.log(`\n[ONBOARD] Processing Fork: ${city}`);
			
			// Resolve contributor-city role ID
			const cityRole = guild.roles.cache.find(r => r.name.toLowerCase() === `contributor-${city.toLowerCase()}`);
			const associatedRoleId = cityRole ? cityRole.id : null;
			if (!associatedRoleId) {
				console.log(`[ONBOARD] Warning: Contributor city role for "contributor-${city}" not found in guild.`);
			}

			// Gather members to onboard
			const membersToOnboard = [];

			// 1. Fork Lead
			const leadId = notion.getLeadDiscordId(fork);
			const leadEmail = fork.properties["What's your email?"]?.rich_text?.[0]?.text?.content || null;
			const leadName = fork.properties["What's your name?"]?.rich_text?.[0]?.text?.content || 'Fork Lead';

			if (leadId) {
				membersToOnboard.push({
					discordId: leadId,
					email: leadEmail,
					name: leadName,
					role: 'Fork Lead'
				});
			}

			// 2. Team Members
			const team = await notion.getTeamMembers(fork.id);
			for (const m of team) {
				if (m.discordId) {
					// Check if they already have an email registered in preferences
					let email = null;
					const pref = await db.get('SELECT email FROM meeting_email_preferences WHERE discord_id = ?', [m.discordId]);
					if (pref && pref.email) {
						email = pref.email;
					} else {
						const avail = await db.get('SELECT email FROM user_availability WHERE discord_id = ?', [m.discordId]);
						if (avail && avail.email) {
							email = avail.email;
						}
					}

					membersToOnboard.push({
						discordId: m.discordId,
						email,
						name: m.name,
						role: m.role || 'Contributor'
					});
				}
			}

			// Onboard each member
			for (const member of membersToOnboard) {
				const memberObj = guild.members.cache.get(member.discordId);
				if (!memberObj) {
					console.log(`[ONBOARD] Skipping ${member.name} (${member.discordId}) - Not in Discord guild.`);
					continue;
				}

				const username = memberObj.user.username;
				const avatar = memberObj.user.avatar;
				const displayName = member.name || memberObj.displayName || username;
				
				// Generate unique booking link
				let bookingLink = 'link_' + username.toLowerCase().substring(0, 10).replace(/[^a-z0-9]/g, '');
				let check = await db.get('SELECT 1 FROM user_availability WHERE booking_link = ? AND discord_id != ?', [bookingLink, member.discordId]);
				let suffix = 1;
				while (check) {
					bookingLink = 'link_' + username.toLowerCase().substring(0, 8).replace(/[^a-z0-9]/g, '') + suffix;
					check = await db.get('SELECT 1 FROM user_availability WHERE booking_link = ? AND discord_id != ?', [bookingLink, member.discordId]);
					suffix++;
				}

				const defaultWeeklyHours = '{"monday":[{"start":"09:00","end":"17:00"}],"tuesday":[{"start":"09:00","end":"17:00"}],"wednesday":[{"start":"09:00","end":"17:00"}],"thursday":[{"start":"09:00","end":"17:00"}],"friday":[{"start":"09:00","end":"17:00"}],"saturday":[],"sunday":[]}'

				const existingUser = await db.get('SELECT 1 FROM user_availability WHERE discord_id = ?', [member.discordId]);
				if (!existingUser) {
					console.log(`[ONBOARD] Pre-onboarding new host: ${displayName} (${username}) -> Link: ${bookingLink}`);
					await db.run(
						`INSERT INTO user_availability (discord_id, username, email, timezone, weekly_hours, booking_link, title, description, associated_role_id, avatar)
						 VALUES (?, ?, ?, 'Asia/Kolkata', ?, ?, ?, ?, ?, ?)`,
						[member.discordId, username, member.email, defaultWeeklyHours, bookingLink, displayName, `${member.role} @ Bits&Bytes ${city}`, associatedRoleId, avatar]
					);
				} else {
					console.log(`[ONBOARD] Updating existing host: ${displayName} (${username})`);
					await db.run(
						`UPDATE user_availability
						 SET email = COALESCE(?, email), associated_role_id = ?, avatar = ?, description = ?
						 WHERE discord_id = ?`,
						[member.email, associatedRoleId, avatar, `${member.role} @ Bits&Bytes ${city}`, member.discordId]
					);
				}
				
				// Ensure email preference matches if email is provided
				if (member.email) {
					const existingPref = await db.get('SELECT 1 FROM meeting_email_preferences WHERE discord_id = ?', [member.discordId]);
					if (!existingPref) {
						await db.run(
							`INSERT INTO meeting_email_preferences (discord_id, email, notify_on_invite, notify_on_reminder, updated_at)
							 VALUES (?, ?, 1, 1, ?)`,
							[member.discordId, member.email, Date.now()]
						);
					}
				}
			}
		}

		console.log('\n[ONBOARD] Pre-onboarding script completed successfully!');
		process.exit(0);
	} catch (err) {
		console.error('[ONBOARD ERROR]', err);
		process.exit(1);
	}
});

client.login(process.env.DISCORD_TOKEN);
