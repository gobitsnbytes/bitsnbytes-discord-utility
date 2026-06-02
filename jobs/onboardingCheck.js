const cron = require('node-cron');
const notion = require('../lib/notion');
const onboarding = require('../lib/onboarding');
const meetingsDb = require('../lib/meetingsDb');

module.exports = (client) => {
	// Run daily at 10 AM
	cron.schedule('0 10 * * *', async () => {
		console.log('[JOB] Running Onboarding Check...');
		
		try {
			const forks = await notion.getForks();
			const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
			const guild = client.guilds.cache.first();
			if (!guild) return;

			// Only find text-based channels
			const leadsCouncil = guild.channels.cache.find(c => c.name === 'leads-council' && c.isTextBased?.());

			for (const fork of activeForks) {
				const onboardingStatus = await notion.getOnboardingStatus(fork.id);
				
				// Skip if onboarding is complete
				if (onboarding.isOnboardingComplete(onboardingStatus)) continue;

				const city = fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
				             fork.properties['Fork Name']?.title?.[0]?.text?.content || 
				             'UNKNOWN';
				const leadId = fork.properties['Discord ID']?.rich_text?.[0]?.text?.content;

				// Get the next pending step
				const nextStep = onboarding.getNextPendingStep(onboardingStatus);
				if (!nextStep) continue;

				// Generate and send reminder
				const reminderMessage = onboarding.generateReminderMessage(onboardingStatus, city);
				
				// Only send if leadsCouncil is text-based and we have a leadId
				if (leadsCouncil && leadsCouncil.isTextBased?.() && leadId) {
					try {
						const dateKey = new Date().toISOString().split('T')[0];
						if (await meetingsDb.tryClaimJobRun('onboardingPing', `${fork.id}-${dateKey}`)) {
							await leadsCouncil.send(`hey <@${leadId}> — ${reminderMessage}`);
						}
					} catch (e) {
						console.error(`[JOB] Failed to send onboarding reminder to ${city}:`, e.message);
					}
				}
			}

			console.log('[JOB] Onboarding Check completed');

		} catch (error) {
			console.error('[JOB ERROR] Onboarding Check failed:', error);
		}
	});
};