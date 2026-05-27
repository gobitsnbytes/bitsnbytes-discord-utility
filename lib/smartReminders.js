/**
 * 🔔 SMART REMINDERS ENGINE
 * Context-aware reminder logic
 */

/**
 * Reminder priority levels
 */
const PRIORITY = {
	CRITICAL: { level: 3, emoji: '🚨', label: 'Critical' },
	HIGH: { level: 2, emoji: '⚠️', label: 'High' },
	MEDIUM: { level: 1, emoji: '📋', label: 'Medium' },
	LOW: { level: 0, emoji: '💡', label: 'Low' },
};

/**
 * Check if reminder should be sent based on conditions
 * @param {Object} forkData - Fork data including health, events, etc.
 * @returns {Array} - Array of reminder objects
 */
function generateReminders(forkData) {
	const reminders = [];
	const { fork, health, teamMembers, events, reports, onboardingStatus } = forkData;

	// Critical: Health score < 20
	if (health?.score < 20) {
		reminders.push({
			type: 'health_critical',
			priority: PRIORITY.CRITICAL,
			message: `Fork health is critical (${health.score}/100). Immediate attention required.`,
			action: 'Review `/fork-status` for details and take action.',
		});
	}

	// High: Missing required roles
	if (teamMembers) {
		const missingRoles = ['Tech Lead', 'Creative Lead', 'Ops Lead', 'Outreach Lead']
			.filter(role => !teamMembers.some(m => m.role === role));
		
		if (missingRoles.length > 0) {
			reminders.push({
				type: 'team_incomplete',
				priority: PRIORITY.HIGH,
				message: `Missing required roles: ${missingRoles.join(', ')}`,
				action: 'Use `/team-update` to assign missing roles.',
			});
		}
	}

	// High: No upcoming events this month
	const now = new Date();
	const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
	const upcomingThisMonth = events?.filter(e => {
		const eventDate = new Date(e.date);
		return eventDate >= now && eventDate <= endOfMonth;
	}) || [];

	if (upcomingThisMonth.length === 0) {
		reminders.push({
			type: 'no_events',
			priority: PRIORITY.HIGH,
			message: 'No events scheduled for this month',
			action: 'Plan an event using `/event-create`.',
		});
	}

	// Medium: Onboarding incomplete
	if (onboardingStatus && onboardingStatus.progress < 7) {
		reminders.push({
			type: 'onboarding_incomplete',
			priority: PRIORITY.MEDIUM,
			message: `Onboarding incomplete (${onboardingStatus.progress}/7 steps)`,
			action: 'Complete remaining steps or ask staff for help.',
		});
	}

	// Medium: Pulse overdue (> 7 days) or never submitted
	const lastPulse = fork.properties['Last Pulse']?.date?.start;
	if (lastPulse) {
		const pulseDate = new Date(lastPulse);
		const daysSincePulse = Math.floor((now - pulseDate) / (1000 * 60 * 60 * 24));
		if (daysSincePulse > 7) {
			reminders.push({
				type: 'pulse_overdue',
				priority: PRIORITY.MEDIUM,
				message: `Last pulse was ${daysSincePulse} days ago`,
				action: 'Submit your weekly pulse.',
			});
		}
	} else {
		// No pulse ever submitted - treat as overdue
		reminders.push({
			type: 'pulse_overdue',
			priority: PRIORITY.MEDIUM,
			message: 'Never submitted a pulse',
			action: 'Submit your weekly pulse to keep your fork active.',
		});
	}

	// Low: Partnership opportunities
	const partnerships = fork.properties['Partnerships Count']?.number || 0;
	if (partnerships === 0) {
		reminders.push({
			type: 'no_partnerships',
			priority: PRIORITY.LOW,
			message: 'No partnerships recorded yet',
			action: 'Consider reaching out to local organizations for partnerships.',
		});
	}

	return reminders.sort((a, b) => b.priority.level - a.priority.level);
}

/**
 * Format reminder for Discord message
 * @param {Object} reminder - Reminder object
 * @returns {string} - Formatted message
 */
function formatReminder(reminder) {
	return `${reminder.priority.emoji} **${reminder.priority.label}**: ${reminder.message}\n` +
		`   → ${reminder.action}`;
}

/**
 * Get reminder summary for a fork
 * @param {Object} forkData - Fork data
 * @returns {string} - Summary string
 */
function getReminderSummary(forkData) {
	const reminders = generateReminders(forkData);
	
	if (reminders.length === 0) {
		return '✅ All systems healthy - no action required.';
	}

	return reminders.map(formatReminder).join('\n');
}

/**
 * Check if should send daily digest
 * @param {number} hour - Current hour (0-23)
 * @returns {boolean} - True if should send
 */
function shouldSendDailyDigest(hour) {
	// Send at 9 AM
	return hour === 9;
}

/**
 * Check if should send weekly digest
 * @param {number} dayOfWeek - Day of week (0-6, 0 = Sunday)
 * @param {number} hour - Current hour
 * @returns {boolean} - True if should send
 */
function shouldSendWeeklyDigest(dayOfWeek, hour) {
	// Send on Monday at 9 AM
	return dayOfWeek === 1 && hour === 9;
}

module.exports = {
	PRIORITY,
	generateReminders,
	formatReminder,
	getReminderSummary,
	shouldSendDailyDigest,
	shouldSendWeeklyDigest,
};