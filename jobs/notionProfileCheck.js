const cron = require('node-cron');
const notion = require('../lib/notion');
const meetingsDb = require('../lib/meetingsDb');

module.exports = (client) => {
	// Run hourly
	cron.schedule('0 * * * *', async () => {
		console.log('[JOB] Running Notion Compliance Check for force-added leads...');

		try {
			const pending = await meetingsDb.getPendingProfiles();
			const guild = client.guilds.cache.first();
			if (!guild) return;

			for (const profile of pending) {
				// 1. Check Notion for the city fork registration
				const fork = await notion.findForkByCity(profile.city);
				
				if (fork) {
					const leadId = fork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
					const status = fork.properties?.Status?.select?.name;

					if (leadId === profile.discord_id && status === 'Active') {
						// Profile matches and is active! Resolve tracking.
						await meetingsDb.resolvePendingProfile(profile.discord_id, profile.city);
						console.log(`[JOB] Resolved pending profile for user ${profile.discord_id} in ${profile.city}.`);

						// Fetch user and send DM
						try {
							const user = await client.users.fetch(profile.discord_id);
							if (user) {
								await user.send(
									`🎉 **Registration Complete!**\n\n` +
									`Your Notion profile for **${profile.city}** has been successfully detected and synchronized with the bot.\n` +
									`Active health tracking, point calculations, and automated reminders are now enabled for your fork.`
								).catch(() => {});
							}
						} catch (err) {
							console.warn(`[JOB] Could not send confirmation DM to resolved user ${profile.discord_id}:`, err.message);
						}
						continue;
					}
				}

				// 2. If not filled, check if we need to send a 24h reminder
				const now = Date.now();
				const reminderInterval = 24 * 60 * 60 * 1000; // 24 hours
				if (now - profile.last_reminded_at >= reminderInterval) {
					try {
						const user = await client.users.fetch(profile.discord_id);
						if (user) {
							const handbookUrl = process.env.FORK_HANDBOOK_URL || 'https://notion.so';
							await user.send(
								`⚠️ **Action Required: Notion Registration Pending**\n\n` +
								`You were force-onboarded as the Fork Lead for **${profile.city}**, but your Notion registration details are still missing.\n` +
								`Please complete your setup by registering your city in the Notion Fork Registry: ${handbookUrl}\n\n` +
								`*This reminder will be sent daily until your Notion registration is complete.*`
							).catch(() => {});
							
							// Update last reminded time
							await meetingsDb.updateProfileReminderTime(profile.discord_id, profile.city);
							console.log(`[JOB] Sent daily registration reminder to user ${profile.discord_id} for ${profile.city}.`);
						}
					} catch (err) {
						console.warn(`[JOB] Could not send reminder DM to pending user ${profile.discord_id}:`, err.message);
					}
				}
			}

			console.log('[JOB] Notion Compliance Check complete.');

		} catch (error) {
			console.error('[JOB ERROR] Notion compliance check failed:', error);
		}
	});
};
