const cron = require('node-cron');
const notion = require('../lib/notion');
const logger = require('../lib/logger');

module.exports = (client) => {
	// Run every Sunday at midnight (0 0 * * 0) - or as per PRD "every 7 days"
	cron.schedule('0 0 * * 0', async () => {
		logger.info('Running Stale Fork Detector job...');
		const forks = await notion.getForks();
		const guild = client.guilds.cache.first(); // Assumes the bot is only in one guild
		if (!guild) return;

		const leadsCouncil = guild.channels.cache.find(c => c.name === 'leads-council');
		const teamForks = guild.channels.cache.find(c => c.name === 'team-forks');
		const now = new Date();

		for (const fork of forks) {
			const city = fork.properties.City.rich_text[0]?.text?.content;
			const lastPulse = fork.properties['Last Pulse']?.date?.start;
			const leadId = fork.properties['Discord ID']?.rich_text[0]?.text?.content;

			if (!lastPulse || !leadId) continue;

			const pulseDate = new Date(lastPulse);
			const diffInDays = Math.floor((now - pulseDate) / (1000 * 60 * 60 * 24));

			if (diffInDays >= 90) {
				// 90+ days: Alert @team for archival
				if (teamForks) {
					await teamForks.send(`🛠️ **Stale Fork Alert**: <@${leadId}> — bitsnbytes-${city.toLowerCase()} hasn't had a pulse in 90 days. @team please review for archival.`);
				}
			} else if (diffInDays >= 60) {
				// 60-89 days: Warning ping to fork lead
				if (leadsCouncil) {
					await leadsCouncil.send(`hey <@${leadId}> — bitsnbytes-${city.toLowerCase()} hasn't had a pulse in 60 days. drop a /pulse update or the branch may be archived.`);
				}
			}
		}
	});
};
