const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
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
	// Run every Monday at 09:00 (0 9 * * 1)
	cron.schedule('0 9 * * 1', async () => {
		logger.info('Initializing Weekly Network Intelligence Brief...');
		
		try {
			const now = new Date();
			const periodKey = `week-${now.getFullYear()}-${getISOWeek(now)}`;
			if (!(await meetingsDb.tryClaimJobRun('weeklyBrief', periodKey))) {
				logger.info('[WEEKLY_BRIEF] Already ran for this period. Skipping.');
				return;
			}

			const forks = await notion.getForks();
			const teamChatId = '1490417184172806285';
			const channel = await client.channels.fetch(teamChatId);
			
			if (!channel) {
				logger.error(`Weekly brief target channel ${teamChatId} not found.`);
				return;
			}

            const isValidFork = (f) => {
                const city = f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content;
                const name = f.properties?.["Fork Name"]?.title?.[0]?.text?.content;
                const altCity = f.properties?.City?.rich_text?.[0]?.text?.content;
                return city || name || altCity;
            };

            const active = forks.filter(isValidFork).filter(f => f.properties?.Status?.select?.name === 'Active');
            const pending = forks.filter(isValidFork).filter(f => f.properties?.Status?.select?.name === 'Pending');

			const briefEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} WEEKLY_INTELLIGENCE // NETWORK_RECAP`)
				.setDescription('Reporting live synchronization status across the protocol.')
				.setColor(config.COLORS.primary)
				.setThumbnail(client.user.displayAvatarURL())
				.addFields(
					{ name: '🟢 SYNCHRONIZED_NODES', value: `\`${active.length}\``, inline: true },
					{ name: '🟠 DISCOVERY_MODES', value: `\`${pending.length}\``, inline: true },
					{ name: '🌐 TOTAL_FOOTPRINT', value: `\`${active.length + pending.length}\``, inline: true }
				)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			await channel.send({ embeds: [briefEmbed] });
			logger.info('Weekly brief delivered successfully.');
		} catch (error) {
			logger.error('Weekly brief job failure', error);
		}
	});
};
