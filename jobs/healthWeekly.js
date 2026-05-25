const cron = require('node-cron');
const notion = require('../lib/notion');
const healthScore = require('../lib/healthScore');
const { EmbedBuilder } = require('discord.js');

module.exports = (client) => {
	// Run every Monday at 9 AM
	cron.schedule('0 9 * * 1', async () => {
		console.log('[JOB] Running Weekly Health Report...');
		
		try {
			const forks = await notion.getForks();
			const rankedForks = healthScore.rankForksByHealth(forks);
			const topForks = healthScore.getTopForks(rankedForks, 5);
			const atRiskForks = healthScore.getAtRiskForks(rankedForks);

			const guild = client.guilds.cache.first();
			if (!guild) return;

			const leadsCouncil = guild.channels.cache.find(c => c.name === 'leads-council');
			const teamForks = guild.channels.cache.find(c => c.name === 'team-forks');

			// Build embed
			const embed = new EmbedBuilder()
				.setTitle('📊 WEEKLY_HEALTH_REPORT')
				.setColor('#00F2FF')
				.setTimestamp()
				.setFooter({ text: 'BITS&BYTES // AUTOMATED_REPORT' });

			// Top 5 performers
			if (topForks.length > 0) {
				const topText = topForks.map((f, i) => {
					const city = (f.fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
					              f.fork.properties['Fork Name']?.title?.[0]?.text?.content || 
					              'UNKNOWN').toUpperCase();
					const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
					return `${medal} **${city}** — ${f.healthScore}/100 ${f.healthStatus.emoji}`;
				}).join('\n');

				embed.addFields({
					name: '🏆 TOP_PERFORMERS',
					value: topText,
					inline: false,
				});
			}

			// At-risk forks
			if (atRiskForks.length > 0) {
				const atRiskText = atRiskForks.slice(0, 5).map(f => {
					const city = (f.fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
					              'UNKNOWN').toUpperCase();
					const leadId = f.fork.properties['Discord ID']?.rich_text?.[0]?.text?.content;
					const mention = leadId ? `<@${leadId}>` : 'No lead';
					return `⚠️ **${city}** (${f.healthScore}/100) — ${mention}`;
				}).join('\n');

				embed.addFields({
					name: '🚨 AT_RISK_FORKS',
					value: atRiskText,
					inline: false,
				});
			}

			// Network stats
			const avgScore = rankedForks.length > 0 
				? Math.round(rankedForks.reduce((sum, f) => sum + f.healthScore, 0) / rankedForks.length)
				: 0;
			const healthyCount = rankedForks.filter(f => f.healthScore >= 60).length;
			const criticalCount = rankedForks.filter(f => f.healthScore < 20).length;

			embed.addFields({
				name: '📈 NETWORK_STATS',
				value: `Total Forks: ${rankedForks.length}\nAvg Health: ${avgScore}/100\nHealthy (60+): ${healthyCount}\nCritical (<20): ${criticalCount}`,
				inline: false,
			});

			// Send to channels
			if (leadsCouncil) {
				await leadsCouncil.send({ embeds: [embed] });
			}
			if (teamForks) {
				await teamForks.send({ embeds: [embed] });
			}

			console.log('[JOB] Weekly Health Report sent successfully');

		} catch (error) {
			console.error('[JOB ERROR] Weekly Health Report failed:', error);
		}
	});
};