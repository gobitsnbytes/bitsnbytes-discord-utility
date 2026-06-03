const cron = require('node-cron');
const notion = require('../lib/notion');
const gamification = require('../lib/gamification');
const healthScore = require('../lib/healthScore');
const meetingsDb = require('../lib/meetingsDb');
const { EmbedBuilder } = require('discord.js');

module.exports = (client) => {
	// Run on 1st of every month at 10 AM
	cron.schedule('0 10 1 * *', async () => {
		console.log('[JOB] Running Monthly Winner Selection...');
		
		try {
			const now = new Date();
			const periodKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
			if (!(await meetingsDb.tryClaimJobRun('monthlyWinner', periodKey))) {
				console.log('[MONTHLY_WINNER] Already ran for this period. Skipping.');
				return;
			}

			const forks = await notion.getForks();
			const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
			const guild = client.guilds.cache.first();
			if (!guild) return;

			const leadsCouncil = guild.channels.cache.find(c => c.name === 'leads-council');
			const teamForks = guild.channels.cache.find(c => c.name === 'team-forks');

			// Calculate monthly points for each fork
			const forkScores = [];
			const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			// Use exclusive upper bound (start of current month) to include entire last month
			const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1);

			const tasks = activeForks.map(fork => async () => {
				const city = fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
				             fork.properties['Fork Name']?.title?.[0]?.text?.content || 
				             'UNKNOWN';
				const leadId = fork.properties['Discord ID']?.rich_text?.[0]?.text?.content;
				const health = healthScore.calculateHealthScore(fork);

				// Get activities for last month
				const reports = await notion.getReports(fork.id);
				const events = await notion.getEvents(fork.id);

				// Use exclusive upper bound (< endOfLastMonth instead of <=)
				const reportsLastMonth = reports.filter(r => {
					const submitted = new Date(r.submittedDate);
					return submitted >= lastMonth && submitted < endOfLastMonth;
				}).length;

				const eventsCompletedLastMonth = events.filter(e => {
					const eventDate = new Date(e.date);
					return e.status === 'Completed' && eventDate >= lastMonth && eventDate < endOfLastMonth;
				}).length;

				// Calculate monthly score
				let monthlyScore = 0;
				monthlyScore += reportsLastMonth * gamification.POINTS.REPORT_SUBMISSION;
				monthlyScore += eventsCompletedLastMonth * gamification.POINTS.EVENT_COMPLETED;
				monthlyScore += health.score * 0.5; // Health score contributes

				// Bonus for team completeness
				const teamMembers = await notion.getTeamMembers(fork.id);
				if (teamMembers.length >= 3) {
					monthlyScore += 10;
				}

				forkScores.push({
					fork,
					city,
					leadId,
					monthlyScore,
					healthScore: health.score,
					reportsCount: reportsLastMonth,
					eventsCount: eventsCompletedLastMonth,
				});
			});

			await notion.limitConcurrency(tasks, 3);

			// Sort by monthly score
			forkScores.sort((a, b) => b.monthlyScore - a.monthlyScore);

			if (forkScores.length === 0) {
				console.log('[JOB] No active forks to select winner from');
				return;
			}

			const winner = forkScores[0];

			// Award winner - track success/failure
			let awardSucceeded = false;
			try {
				await notion.updateForkPoints(winner.fork.id, gamification.POINTS.MONTHLY_WINNER);
				await notion.addBadgeToFork(winner.fork.id, 'monthly_champion');
				awardSucceeded = true;
			} catch (e) {
				console.error('[JOB] Failed to award winner:', e.message);
				// Continue to announce winner, but without rewards field
			}

			// Build announcement embed
			const embed = new EmbedBuilder()
				.setTitle('👑 MONTHLY_CHAMPION')
				.setColor('#FFD700')
				.setTimestamp()
				.setFooter({ text: 'BITS&BYTES // MONTHLY_WINNER' });

			// Winner announcement
			const monthName = lastMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
			embed.addFields({
				name: `🏆 ${monthName} WINNER`,
				value: `🎉 **${winner.city.toUpperCase()}** has won this month's leaderboard!\n` +
					`Score: ${Math.round(winner.monthlyScore)} pts\n` +
					`Health: ${winner.healthScore}/100\n` +
					`Reports: ${winner.reportsCount} | Events: ${winner.eventsCount}`,
				inline: false,
			});

			// Prize - only show if award succeeded
			if (awardSucceeded) {
				embed.addFields({
					name: '🎁 REWARDS',
					value: `+${gamification.POINTS.MONTHLY_WINNER} points\n👑 Monthly Champion badge`,
					inline: false,
				});
			} else {
				embed.addFields({
					name: '⚠️ REWARDS_PENDING',
					value: 'Points and badge could not be awarded automatically. Please contact an administrator.',
					inline: false,
				});
			}

			// Top 3
			if (forkScores.length >= 2) {
				const topThree = forkScores.slice(0, 3).map((f, i) => {
					const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
					return `${medal} **${f.city.toUpperCase()}** — ${Math.round(f.monthlyScore)} pts`;
				}).join('\n');

				embed.addFields({
					name: '📊 TOP_PERFORMERS',
					value: topThree,
					inline: false,
				});
			}

			// Send to channels
			if (leadsCouncil) {
				if (winner.leadId) {
					await leadsCouncil.send({ content: `🎉 Congratulations <@${winner.leadId}>!`, embeds: [embed] });
				} else {
					await leadsCouncil.send({ embeds: [embed] });
				}
			}
			if (teamForks) {
				await teamForks.send({ embeds: [embed] });
			}

			console.log(`[JOB] Monthly Winner: ${winner.city} with ${Math.round(winner.monthlyScore)} points`);

		} catch (error) {
			console.error('[JOB ERROR] Monthly Winner Selection failed:', error);
		}
	});
};