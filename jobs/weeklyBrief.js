const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');

module.exports = (client) => {
	// Run every Monday at 09:00 (0 9 * * 1)
	cron.schedule('0 9 * * 1', async () => {
		console.log('[JOB] Initializing Weekly Network Intelligence Brief...');
		
		try {
			const forks = await notion.getForks();
			const teamChatId = '1490417184172806285';
			const channel = await client.channels.fetch(teamChatId);
			
			if (!channel) {
				console.error(`[BRIEF ERROR] Target channel ${teamChatId} not found.`);
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
			console.log('[JOB] Weekly brief delivered to #team-chat.');
		} catch (error) {
			console.error('[BRIEF JOB ERROR]', error);
		}
	});
};
