const cron = require('node-cron');
const notion = require('../lib/notion');

/**
 * Report Late Updater Job
 * Queries reports with status 'on-time' and marks them as 'late' if past their deadline.
 * Runs hourly to ensure reports are flagged appropriately after deadlines pass.
 */
module.exports = (client) => {
	// Run hourly at minute 0
	cron.schedule('0 * * * *', async () => {
		console.log('[JOB] Running Report Late Updater...');
		
		try {
			const forks = await notion.getForks();
			const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
			const now = new Date();

			// Get timezone-aware current date (using local timezone)
			const currentYear = now.getFullYear();
			const currentMonth = now.getMonth();
			const currentDay = now.getDate();

			let updatedCount = 0;
			const tasks = activeForks.map(fork => async () => {
				const reports = await notion.getReports(fork.id);
				
				// Only check reports marked as 'on-time'
				const onTimeReports = reports.filter(r => r.status === 'on-time');
				
				for (const report of onTimeReports) {
					if (!report.submittedDate) continue;
					
					const submittedDate = new Date(report.submittedDate);
					const submitYear = submittedDate.getFullYear();
					const submitMonth = submittedDate.getMonth();
					const submitDay = submittedDate.getDate();

					let isLate = false;

					if (report.type === 'monthly') {
						const prevMonthDate = new Date(submitYear, submitMonth - 1, 1);
						const hasPrevReport = reports.some(r => {
							if (r.id === report.id || r.type !== 'monthly') return false;
							const d = new Date(r.submittedDate);
							return d.getMonth() === prevMonthDate.getMonth() && d.getFullYear() === prevMonthDate.getFullYear();
						});

						if (!hasPrevReport) {
							const deadline = new Date(submitYear, submitMonth, 0, 23, 59, 59);
							if (submittedDate > deadline) {
								isLate = true;
							}
						} else {
							const deadline = new Date(submitYear, submitMonth + 1, 0, 23, 59, 59);
							if (submittedDate > deadline) {
								isLate = true;
							}
						}
					} else if (report.type === 'bi-weekly') {
						if (submitDay <= 15) {
							const prevMonthDate = new Date(submitYear, submitMonth - 1, 16);
							const hasPrevReport = reports.some(r => {
								if (r.id === report.id || r.type !== 'bi-weekly') return false;
								const d = new Date(r.submittedDate);
								return d.getMonth() === prevMonthDate.getMonth() && 
								       d.getFullYear() === prevMonthDate.getFullYear() && 
								       d.getDate() >= 16;
							});

							if (!hasPrevReport) {
								const lastDayPrev = new Date(submitYear, submitMonth, 0).getDate();
								const deadline = new Date(submitYear, submitMonth - 1, lastDayPrev, 23, 59, 59);
								if (submittedDate > deadline) {
									isLate = true;
								}
							} else {
								const deadline = new Date(submitYear, submitMonth, 15, 23, 59, 59);
								if (submittedDate > deadline) {
									isLate = true;
								}
							}
						} else {
							const hasPrevReport = reports.some(r => {
								if (r.id === report.id || r.type !== 'bi-weekly') return false;
								const d = new Date(r.submittedDate);
								return d.getMonth() === submitMonth && 
								       d.getFullYear() === submitYear && 
								       d.getDate() <= 15;
							});

							if (!hasPrevReport) {
								const deadline = new Date(submitYear, submitMonth, 15, 23, 59, 59);
								if (submittedDate > deadline) {
									isLate = true;
								}
							} else {
								const lastDay = new Date(submitYear, submitMonth + 1, 0).getDate();
								const deadline = new Date(submitYear, submitMonth, lastDay, 23, 59, 59);
								if (submittedDate > deadline) {
									isLate = true;
								}
							}
						}
					}

					if (isLate) {
						try {
							await notion.updateReport(report.id, { status: 'late' });
							updatedCount++;
							console.log(`[JOB] Marked report ${report.id} as late for fork in ${notion.getCityName(fork)}`);
						} catch (e) {
							console.error(`[JOB] Failed to mark report ${report.id} as late:`, e.message);
						}
					}
				}
			});

			await notion.limitConcurrency(tasks, 3);

			console.log(`[JOB] Report Late Updater completed. Updated ${updatedCount} reports.`);

		} catch (error) {
			console.error('[JOB ERROR] Report Late Updater failed:', error);
		}
	});
};