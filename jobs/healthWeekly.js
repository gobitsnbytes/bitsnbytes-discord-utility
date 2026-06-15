const cron = require('node-cron');
const notion = require('../lib/notion');
const healthScore = require('../lib/healthScore');
const meetingsDb = require('../lib/meetingsDb');
const teamValidator = require('../lib/teamValidator');
const gamification = require('../lib/gamification');
const { EmbedBuilder } = require('discord.js');

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
	// Run every Monday at 9 AM
	cron.schedule('0 9 * * 1', async () => {
		console.log('[JOB] Running Weekly Health Report...');
		
		try {
			const now = new Date();
			const periodKey = `week-${now.getFullYear()}-${getISOWeek(now)}`;
			if (!(await meetingsDb.tryClaimJobRun('healthWeekly', periodKey))) {
				console.log('[HEALTH_WEEKLY] Already ran for this period. Skipping.');
				return;
			}

			const forks = await notion.getForks();
			const rankedForks = healthScore.rankForksByHealth(forks);
			const topForks = healthScore.getTopForks(rankedForks, 5);
			const atRiskForks = healthScore.getAtRiskForks(rankedForks);

			const guild = client.guilds.cache.first();
			if (!guild) return;

			let leadsCouncil = guild.channels.cache.find(c => c.name === 'leads-council');
			let teamForks = guild.channels.cache.find(c => c.name === 'team-forks');

			// Fallback channel fetch
			if (!leadsCouncil || !teamForks) {
				try {
					const allChannels = await guild.channels.fetch();
					if (!leadsCouncil) leadsCouncil = allChannels.find(c => c.name === 'leads-council');
					if (!teamForks) teamForks = allChannels.find(c => c.name === 'team-forks');
				} catch (fetchErr) {
					console.warn('[HEALTH_WEEKLY] Failed to fetch all channels for fallback:', fetchErr.message);
				}
			}

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

			// Localized city-specific channels update and Notion Sync
			for (const f of rankedForks) {
				const city = (f.fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
				              f.fork.properties['Fork Name']?.title?.[0]?.text?.content || 
				              'UNKNOWN').trim();
				if (city === 'UNKNOWN') continue;

				// 1. Sync Weekly Health back to Notion
				await notion.updateForkHealth(f.fork.id, f.healthScore).catch(err => {
					console.error(`[HEALTH_WEEKLY] Failed to update Notion health for ${city}:`, err.message);
				});

				// 2. Fetch resources to calculate and sync badges to Notion
				let earnedBadges = [];
				try {
					const teamMembers = await notion.getTeamMembers(f.fork.id).catch(() => []);
					const teamValidation = teamValidator.validateTeam(teamMembers);
					const events = await notion.getEvents(f.fork.id).catch(() => []);
					const reports = await notion.getReports(f.fork.id).catch(() => []);
					const onboardingStatus = await notion.getOnboardingStatus(f.fork.id).catch(() => ({ progress: 0 }));

					const activeMonths = new Set();
					reports.forEach(r => {
						if (r.submittedDate) {
							const d = new Date(r.submittedDate);
							activeMonths.add(`${d.getFullYear()}-${d.getMonth()}`);
						}
					});
					events.filter(e => e.status === 'Completed').forEach(e => {
						if (e.date) {
							const d = new Date(e.date);
							activeMonths.add(`${d.getFullYear()}-${d.getMonth()}`);
						}
					});

					let activeMonthsStreak = 0;
					const checkNow = new Date();
					for (let i = 0; i < 12; i++) {
						const checkDate = new Date(checkNow.getFullYear(), checkNow.getMonth() - i, 1);
						const key = `${checkDate.getFullYear()}-${checkDate.getMonth()}`;
						if (activeMonths.has(key)) {
							activeMonthsStreak++;
						} else if (i > 0) {
							break;
						}
					}

					const forkData = {
						health: { score: f.healthScore },
						totalEvents: events.filter(e => e.status === 'Completed').length,
						teamComplete: teamValidation.isValid,
						teamMembersAdded: teamMembers.length,
						pulseStreak: 0,
						reportsOnTime: reports.filter(r => r.status === 'on-time').length,
						partnerships: f.fork.properties['Partnerships Count']?.number || 0,
						onboardingComplete: onboardingStatus.progress === 7,
						maxEventAttendance: Math.max(...events.map(e => e.actualAttendees || 0), 0),
						activeMonthsStreak,
					};

					earnedBadges = gamification.determineBadges(forkData);
					await notion.updateForkBadges(f.fork.id, earnedBadges);
				} catch (badgeErr) {
					console.error(`[HEALTH_WEEKLY] Failed to compute or update badges for ${city}:`, badgeErr.message);
				}

				const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;
				let cityChannel = guild.channels.cache.find(c => c.name === channelName);

				if (!cityChannel) {
					try {
						const allChannels = await guild.channels.fetch();
						cityChannel = allChannels.find(c => c.name === channelName);
					} catch (fetchErr) {
						console.warn(`[HEALTH_WEEKLY] Failed to fetch city channel ${channelName} for fallback:`, fetchErr.message);
					}
				}

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

					if (earnedBadges.length > 0) {
						localEmbed.addFields({
							name: '🏅 Badges Earned',
							value: earnedBadges.map(id => {
								const b = gamification.getBadgeById(id);
								return b ? `${b.emoji} **${b.name}**` : id;
							}).join(', '),
							inline: false
						});
					}

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