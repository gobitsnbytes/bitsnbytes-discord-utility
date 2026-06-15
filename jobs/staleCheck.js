const cron = require('node-cron');
const notion = require('../lib/notion');
const logger = require('../lib/logger');
const meetingsDb = require('../lib/meetingsDb');

function getISOWeek(date) {
	const tempDate = new Date(date.valueOf());
	const dayNum = (date.getDay() + 6) % 7;
	tempDate.setDate(tempDate.getDate() - dayNum + 3);
	const firstThursday = tempDate.valueOf();
	tempDate.setMonth(0, 1);
	if (tempDate.getDay() !== 4) {
		tempDate.setMonth(0, 1 + ((4 - tempDate.getDay() + 7) % 7));
	}
	return 1 + Math.ceil((firstThursday - tempDate) / 604800000);
}

module.exports = (client) => {
	// Run every Sunday at midnight (0 0 * * 0) - or as per PRD "every 7 days"
	cron.schedule('0 0 * * 0', async () => {
		logger.info('Running Stale Fork Detector job...');
		
		try {
			const forks = await notion.getForks();
			const guild = client.guilds.cache.first(); // Assumes the bot is only in one guild
			if (!guild) return;

			let leadsCouncil = guild.channels.cache.find(c => c.name === 'leads-council');
			let teamForks = guild.channels.cache.find(c => c.name === 'team-forks');

			if (!leadsCouncil || !teamForks) {
				try {
					const allChannels = await guild.channels.fetch();
					if (!leadsCouncil) leadsCouncil = allChannels.find(c => c.name === 'leads-council');
					if (!teamForks) teamForks = allChannels.find(c => c.name === 'team-forks');
				} catch (fetchErr) {
					logger.error('Failed to fetch all channels for fallback in staleCheck:', fetchErr.message);
				}
			}
			const now = new Date();
			const isoWeek = getISOWeek(now);

			for (const fork of forks) {
				const city = notion.getCityName(fork);
				const lastPulse = fork.properties['Last Pulse']?.date?.start;
				const leadId = fork.properties['Discord ID']?.rich_text?.[0]?.text?.content;

				if (!leadId) continue;
				const pulseDateStr = lastPulse || fork.created_time;
				if (!pulseDateStr) continue;

				const pulseDate = new Date(pulseDateStr);
				const diffInDays = Math.floor((now - pulseDate) / (1000 * 60 * 60 * 24));

				if (diffInDays >= 90) {
					// 90+ days: Alert @team for archival
					if (teamForks) {
						if (await meetingsDb.tryClaimJobRun('staleAlert-90', `${fork.id}-week-${isoWeek}`)) {
							await teamForks.send(`🛠️ **Stale Fork Alert**: <@${leadId}> — bitsnbytes-${city.toLowerCase()} hasn't had a pulse in 90 days. @team please review for archival.`);
						}
					}
				} else if (diffInDays >= 60) {
					// 60-89 days: Warning ping to fork lead
					if (leadsCouncil) {
						if (await meetingsDb.tryClaimJobRun('staleAlert-60', `${fork.id}-week-${isoWeek}`)) {
							await leadsCouncil.send(`hey <@${leadId}> — bitsnbytes-${city.toLowerCase()} hasn't had a pulse in 60 days. drop a /pulse update or the branch may be archived.`);
						}
					}
				}
			}
		} catch (err) {
			logger.error('Stale Fork Detector job failed', err);
		}
	});
};
