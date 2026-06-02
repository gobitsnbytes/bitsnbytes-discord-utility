const cron = require('node-cron');
const notion = require('../lib/notion');
const healthScore = require('../lib/healthScore');
const smartReminders = require('../lib/smartReminders');
const meetingsDb = require('../lib/meetingsDb');
const { EmbedBuilder } = require('discord.js');

// Notion-persisted reminder store with a 30-day cooldown
const reminderStore = {
	// Check if reminder was already sent and is within the 30-day cooldown
	async hasBeenSent(forkId, reminderType) {
		const lastSent = await notion.getSentReminder(forkId, reminderType);
		if (!lastSent) return false;
		
		const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
		return lastSent >= thirtyDaysAgo;
	},
	
	// Record that a reminder was sent
	async recordSent(forkId, reminderType) {
		await notion.recordSentReminder(forkId, reminderType);
	}
};

module.exports = (client) => {
	// Run daily at 9:05 AM (staggered from reportReminders)
	cron.schedule('5 9 * * *', async () => {
		console.log('[JOB] Running Daily Reminder Check...');
		
		try {
			const now = new Date();
			const dateKey = now.toISOString().split('T')[0];
			if (!(await meetingsDb.tryClaimJobRun('reminderCheck', dateKey))) {
				console.log('[REMINDER_CHECK] Already ran for today. Skipping.');
				return;
			}

			const forks = await notion.getForks();
			const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
			const guild = client.guilds.cache.first();
			if (!guild) return;

			const leadsCouncil = guild.channels.cache.find(c => c.name === 'leads-council');

			for (const fork of activeForks) {
				const leadId = fork.properties['Discord ID']?.rich_text?.[0]?.text?.content;
				const city = fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
				             fork.properties['Fork Name']?.title?.[0]?.text?.content || 
				             'UNKNOWN';

				if (!leadId || !leadsCouncil) continue;

				// Gather fork data
				const health = healthScore.calculateHealthScore(fork);
				const teamMembers = await notion.getTeamMembers(fork.id);
				const events = await notion.getEvents(fork.id);
				const reports = await notion.getReports(fork.id);
				const onboardingStatus = await notion.getOnboardingStatus(fork.id);

				// Generate reminders
				const reminders = smartReminders.generateReminders({
					fork,
					health,
					teamMembers,
					events,
					reports,
					onboardingStatus,
				});

				// Only send if there are critical or high priority reminders
				// Filter out reminders that were already sent
				const urgentReminders = [];
				for (const r of reminders) {
					if (r.priority.level >= smartReminders.PRIORITY.HIGH.level) {
						const hasSent = await reminderStore.hasBeenSent(fork.id, r.type);
						if (!hasSent) {
							urgentReminders.push(r);
						}
					}
				}

				if (urgentReminders.length > 0) {
					const embed = new EmbedBuilder()
						.setTitle(`🔔 DAILY_DIGEST // ${city.toUpperCase()}`)
						.setColor('#FFCC00')
						.setTimestamp()
						.setFooter({ text: 'BITS&BYTES // AUTOMATED_REMINDER' });

					const reminderText = urgentReminders.map(smartReminders.formatReminder).join('\n\n');
					embed.addFields({
						name: '⚠️ ACTION_REQUIRED',
						value: reminderText.substring(0, 1000),
						inline: false,
					});

					await leadsCouncil.send({ content: `<@${leadId}>`, embeds: [embed] });

					// Record successful sends
					for (const reminder of urgentReminders) {
						await reminderStore.recordSent(fork.id, reminder.type);
					}
				}
			}

			console.log('[JOB] Daily Reminder Check completed');

		} catch (error) {
			console.error('[JOB ERROR] Daily Reminder Check failed:', error);
		}
	});
};