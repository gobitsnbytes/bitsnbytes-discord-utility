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

			// Localized city-specific channels update
			for (const f of rankedForks) {
				const city = (f.fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
				              f.fork.properties['Fork Name']?.title?.[0]?.text?.content || 
				              'UNKNOWN').trim();
				if (city === 'UNKNOWN') continue;

				const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;
				const cityChannel = guild.channels.cache.find(c => c.name === channelName);

				if (cityChannel && cityChannel.isTextBased()) {
					const localEmbed = new EmbedBuilder()
						.setTitle(`Weekly Health Update: ${city}`)
						.setColor(f.healthStatus.color)
						.setDescription(`Current status: **${f.healthStatus.label}** ${f.healthStatus.emoji}`)
						.addFields(
							{ name: 'Health Score', value: `${f.healthScore}/100`, inline: true },
							{ name: 'Gamification Points', value: `${f.fork.properties['Points']?.number || 0} ⭐`, inline: true }
						)
						.addFields({
							name: 'Score Breakdown',
							value: `• Last Pulse: ${f.healthBreakdown.pulseRecency}/25\n` +
							       `• Events: ${f.healthBreakdown.eventsConducted}/25\n` +
							       `• Team Completeness: ${f.healthBreakdown.teamCompleteness}/20\n` +
							       `• Reports Submitted: ${f.healthBreakdown.reportSubmission}/15\n` +
							       `• Partnerships: ${f.healthBreakdown.partnerships}/15`,
							inline: false
						})
						.setTimestamp()
						.setFooter({ text: 'Bits&Bytes // Weekly Summary' });

					if (f.healthScore < 80) {
						let actionItems = [];
						if (f.healthBreakdown.pulseRecency < 25) actionItems.push('• Post a pulse update using `/pulse` to restore recency points.');
						if (f.healthBreakdown.eventsConducted < 25) actionItems.push('• Coordinate or plan a new event using `/event-create`.');
						if (f.healthBreakdown.teamCompleteness < 20) actionItems.push('• Complete your team setup roles using `/team-update`.');
						if (f.healthBreakdown.reportSubmission < 15) actionItems.push('• Submit your bi-weekly or monthly report using `/report-submit`.');
						
						if (actionItems.length > 0) {
							localEmbed.addFields({
								name: 'Recommended Action Items',
								value: actionItems.join('\n'),
								inline: false
							});
						}
					}

					await cityChannel.send({ embeds: [localEmbed] }).catch(err => {
						console.error(`Failed to send health report to ${channelName}:`, err.message);
					});
				}
			}

			console.log('[JOB] Weekly Health Report sent successfully');

		} catch (error) {
			console.error('[JOB ERROR] Weekly Health Report failed:', error);
		}
	});
};