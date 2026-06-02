const cron = require('node-cron');
const notion = require('../lib/notion');
const meetingsDb = require('../lib/meetingsDb');

module.exports = (client) => {
	// Run daily at 9 AM
	cron.schedule('0 9 * * *', async () => {
		console.log('[JOB] Running Report Reminders Check...');
		
		try {
			const forks = await notion.getForks();
			const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
			const guild = client.guilds.cache.first();
			if (!guild) return;

			const leadsCouncil = guild.channels.cache.find(c => c.name === 'leads-council');

			// Calculate report deadlines
			const now = new Date();
			const currentDay = now.getDate();
			const currentMonth = now.getMonth();
			const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate();

			// Monthly report: Due on the last day of the month
			const monthlyDueDate = daysInMonth;
			const daysUntilMonthly = monthlyDueDate - currentDay;

			// Bi-weekly report: Due every 2 weeks (on 15th and last day)
			const biweeklyDueDate1 = 15;
			const biweeklyDueDate2 = daysInMonth;
			const daysUntilBiweekly1 = biweeklyDueDate1 - currentDay;
			const daysUntilBiweekly2 = biweeklyDueDate2 - currentDay;
			const daysUntilBiweekly = daysUntilBiweekly1 > 0 ? daysUntilBiweekly1 : daysUntilBiweekly2;

			for (const fork of activeForks) {
				const city = fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
				             fork.properties['Fork Name']?.title?.[0]?.text?.content || 
				             'UNKNOWN';
				const leadId = fork.properties['Discord ID']?.rich_text?.[0]?.text?.content;

				if (!leadId || !leadsCouncil) continue;

			// Get reports for this fork
			const reports = await notion.getReports(fork.id);

			// Previous month reports for monthly overdue check on the 1st
			const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const previousMonthReports = reports.filter(r => {
				const submitted = new Date(r.submittedDate);
				return submitted.getMonth() === previousMonth.getMonth() && 
				       submitted.getFullYear() === previousMonth.getFullYear();
			});
			const previousMonthSubmitted = previousMonthReports.some(r => r.type === 'monthly');

			// Bi-weekly report sets: first half (days 1-15) and second half (days 16-end)
			const firstHalfReports = reports.filter(r => {
				const submitted = new Date(r.submittedDate);
				const day = submitted.getDate();
				return submitted.getMonth() === currentMonth && 
				       submitted.getFullYear() === now.getFullYear() && 
				       day >= 1 && day <= 15;
			});
			const targetMonthForSecondHalf = currentDay === 1 ? previousMonth.getMonth() : currentMonth;
			const targetYearForSecondHalf = currentDay === 1 ? previousMonth.getFullYear() : now.getFullYear();

			const secondHalfReports = reports.filter(r => {
				const submitted = new Date(r.submittedDate);
				const day = submitted.getDate();
				return submitted.getMonth() === targetMonthForSecondHalf && 
				       submitted.getFullYear() === targetYearForSecondHalf && 
				       day >= 16;
			});

			const firstHalfSubmitted = firstHalfReports.some(r => r.type === 'bi-weekly');
			const secondHalfSubmitted = secondHalfReports.some(r => r.type === 'bi-weekly');

			// This month's monthly report for upcoming deadline reminder
			const thisMonthMonthlyReports = reports.filter(r => {
				const submitted = new Date(r.submittedDate);
				return submitted.getMonth() === currentMonth && 
				       submitted.getFullYear() === now.getFullYear() &&
				       r.type === 'monthly';
			});
			const monthlyReportSubmitted = thisMonthMonthlyReports.length > 0;

			const dateKey = now.toISOString().split('T')[0];

			// 48 hours before monthly deadline
			if (daysUntilMonthly === 2 && !monthlyReportSubmitted) {
				if (await meetingsDb.tryClaimJobRun('reportReminder', `${fork.id}-monthly-48h-${dateKey}`)) {
					await leadsCouncil.send(`📋 <@${leadId}> — Monthly report for ${city} is due in 48 hours. Submit via \`/report-submit\` to stay on track!`);
				}
			}

			// Monthly deadline missed (check on 1st of new month if last month's report wasn't submitted)
			if (currentDay === 1 && !previousMonthSubmitted) {
				if (await meetingsDb.tryClaimJobRun('reportReminder', `${fork.id}-monthly-overdue-${dateKey}`)) {
					await leadsCouncil.send(`⚠️ <@${leadId}> — Monthly report for ${city} is overdue. Please submit immediately to avoid health score impact.`);
				}
			}

			// Bi-weekly deadline missed (check day after bi-weekly due dates)
			// First half overdue: check on 16th if first half bi-weekly wasn't submitted
			if (currentDay === 16 && !firstHalfSubmitted) {
				if (await meetingsDb.tryClaimJobRun('reportReminder', `${fork.id}-biweekly-1-overdue-${dateKey}`)) {
					await leadsCouncil.send(`⚠️ <@${leadId}> — Bi-weekly report (first half) for ${city} is overdue. Please submit immediately!`);
				}
			}
			// Second half overdue: check on 1st if second half bi-weekly wasn't submitted
			if (currentDay === 1 && !secondHalfSubmitted) {
				if (await meetingsDb.tryClaimJobRun('reportReminder', `${fork.id}-biweekly-2-overdue-${dateKey}`)) {
					await leadsCouncil.send(`⚠️ <@${leadId}> — Bi-weekly report (second half) for ${city} is overdue. Please submit immediately!`);
				}
			}

			// 48 hours before bi-weekly deadline
			if (daysUntilBiweekly1 === 2 && !firstHalfSubmitted) {
				if (await meetingsDb.tryClaimJobRun('reportReminder', `${fork.id}-biweekly-1-48h-${dateKey}`)) {
					await leadsCouncil.send(`📋 <@${leadId}> — Bi-weekly report for ${city} is due in 48 hours. Submit via \`/report-submit\`!`);
				}
			}
			if (daysUntilBiweekly2 === 2 && !secondHalfSubmitted) {
				if (await meetingsDb.tryClaimJobRun('reportReminder', `${fork.id}-biweekly-2-48h-${dateKey}`)) {
					await leadsCouncil.send(`📋 <@${leadId}> — Bi-weekly report for ${city} is due in 48 hours. Submit via \`/report-submit\`!`);
				}
			}
			}

			console.log('[JOB] Report Reminders Check completed');

		} catch (error) {
			console.error('[JOB ERROR] Report Reminders Check failed:', error);
		}
	});
};