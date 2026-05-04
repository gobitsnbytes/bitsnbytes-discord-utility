/**
 * 🏆 GAMIFICATION ENGINE
 * Points and badge calculation system
 */

/**
 * Points values for activities
 * Updated: New point allocation model
 */
const POINTS = {
	// === EVENTS ===
	EVENT_CREATED: 10,        // Event Created → +10 points
	EVENT_APPROVED: 20,       // Event Approved → +20 points
	EVENT_COMPLETED: 50,      // Event Completed → +50 points
	EVENT_CANCELLED: -5,      // Penalty for cancelled events
	SPONSOR_SECURED: 10,      // Per sponsor secured → +10 points

	// === ENGAGEMENT ===
	REPORT_SUBMISSION: 15,    // Report Submitted → +15 points
	REPORT_ON_TIME: 10,       // On-time Report Submission → +10 bonus
	REPORT_LATE: -15,         // Missed Report Deadline without prior information → -15 points
	PULSE_SUBMITTED: 10,      // Weekly Pulse Update → +10 points
	PULSE_STREAK_WEEK: 3,     // 4+ weeks in a row bonus
	PULSE_OVERDUE: -2,        // Penalty for overdue pulse

	// === QUALITY CONTROL ===
	INACTIVE_2_WEEKS: -25,    // Inactive for 2 weeks → -25 points

	// === TEAM ===
	TEAM_COMPLETE: 5,         // All roles filled
	TEAM_MEMBER_ADDED: 1,     // Per team member added

	// === ONBOARDING ===
	ONBOARDING_COMPLETE: 20,  // Complete all onboarding steps

	// === PARTNERSHIPS ===
	PARTNERSHIP_ADDED: 3,     // Per partnership secured

	// === SPECIAL ===
	MONTHLY_WINNER: 50,       // Monthly leaderboard winner
	HEALTH_SCORE_80: 10,      // Weekly bonus for health 80+
	HEALTH_SCORE_90: 20,      // Weekly bonus for health 90+
};

/**
 * Badge definitions
 */
const BADGES = {
	// Event badges
	FIRST_EVENT: { id: 'first_event', name: 'First Steps', emoji: '🎯', description: 'Hosted first event' },
	EVENT_HERO: { id: 'event_hero', name: 'Event Hero', emoji: '🎉', description: 'Hosted 5+ events' },
	EVENT_LEGEND: { id: 'event_legend', name: 'Event Legend', emoji: '🏆', description: 'Hosted 10+ events' },

	// Team badges
	TEAM_BUILDER: { id: 'team_builder', name: 'Team Builder', emoji: '👥', description: 'Complete team structure' },
	RECRUITER: { id: 'recruiter', name: 'Recruiter', emoji: '🤝', description: 'Added 5+ team members' },

	// Activity badges
	PULSE_MASTER: { id: 'pulse_master', name: 'Pulse Master', emoji: '💓', description: '8 weeks pulse streak' },
	REPORTER: { id: 'reporter', name: 'Reliable Reporter', emoji: '📝', description: '10 reports on time' },

	// Health badges
	HEALTHY: { id: 'healthy', name: 'Healthy Fork', emoji: '💚', description: 'Health score 60+' },
	THRIVING: { id: 'thriving', name: 'Thriving Fork', emoji: '🌟', description: 'Health score 80+' },
	EXCEPTIONAL: { id: 'exceptional', name: 'Exceptional', emoji: '💎', description: 'Health score 95+' },

	// Partnership badges
	PARTNER_UP: { id: 'partner_up', name: 'Partner Up', emoji: '🤝', description: 'First partnership secured' },
	CONNECTED: { id: 'connected', name: 'Connected', emoji: '🌐', description: '5+ partnerships' },

	// Special badges
	ONBOARDED: { id: 'onboarded', name: 'Fully Onboarded', emoji: '✅', description: 'Completed all onboarding steps' },
	MONTHLY_CHAMPION: { id: 'monthly_champion', name: 'Monthly Champion', emoji: '👑', description: 'Won monthly leaderboard' },
	ON_FIRE: { id: 'on_fire', name: 'On Fire', emoji: '🔥', description: '3+ consecutive active months' },
	RISING_STAR: { id: 'rising_star', name: 'Rising Star', emoji: '⭐', description: 'Most improved fork' },
	EARLY_BIRD: { id: 'early_bird', name: 'Early Bird', emoji: '🐦', description: 'First pulse of the week' },

	// Attendance badges
	CROWD_PLEASER: { id: 'crowd_pleaser', name: 'Crowd Pleaser', emoji: '🎪', description: '50+ attendees at an event' },
	PACKED_HOUSE: { id: 'packed_house', name: 'Packed House', emoji: '🏟️', description: '100+ attendees at an event' },
};

/**
 * Calculate total points for a fork
 * @param {Object} forkData - Fork data with activities
 * @returns {number} - Total points
 */
function calculateTotalPoints(forkData) {
	let total = 0;

	// Base points from stored value
	if (forkData.points) {
		total += forkData.points;
	}

	// Health score bonus (weekly)
	if (forkData.health?.score >= 90) {
		total += POINTS.HEALTH_SCORE_90;
	} else if (forkData.health?.score >= 80) {
		total += POINTS.HEALTH_SCORE_80;
	}

	return total;
}

/**
 * Calculate points for this month
 * @param {Object} activities - Activity data
 * @returns {number} - Monthly points
 */
function calculateMonthlyPoints(activities) {
	let points = 0;

	// Reports this month
	points += (activities.reportsThisMonth || 0) * POINTS.REPORT_SUBMISSION;

	// Events completed this month
	points += (activities.eventsCompletedThisMonth || 0) * POINTS.EVENT_COMPLETED;

	// Pulses this month
	points += (activities.pulsesThisMonth || 0) * POINTS.PULSE_SUBMITTED;

	// Pulse streak bonus
	if (activities.pulseStreak >= 4) {
		points += POINTS.PULSE_STREAK_WEEK;
	}

	// Partnerships this month
	points += (activities.partnershipsThisMonth || 0) * POINTS.PARTNERSHIP_ADDED;

	return points;
}

/**
 * Determine badges earned by a fork
 * @param {Object} forkData - Fork data
 * @returns {Array} - Array of earned badge objects
 */
function determineBadges(forkData) {
	const earned = [];

	// Event badges
	if (forkData.totalEvents >= 1) earned.push(BADGES.FIRST_EVENT);
	if (forkData.totalEvents >= 5) earned.push(BADGES.EVENT_HERO);
	if (forkData.totalEvents >= 10) earned.push(BADGES.EVENT_LEGEND);

	// Team badges
	if (forkData.teamComplete) earned.push(BADGES.TEAM_BUILDER);
	if (forkData.teamMembersAdded >= 5) earned.push(BADGES.RECRUITER);

	// Activity badges
	if (forkData.pulseStreak >= 8) earned.push(BADGES.PULSE_MASTER);
	if (forkData.reportsOnTime >= 10) earned.push(BADGES.REPORTER);

	// Health badges
	if (forkData.health?.score >= 60) earned.push(BADGES.HEALTHY);
	if (forkData.health?.score >= 80) earned.push(BADGES.THRIVING);
	if (forkData.health?.score >= 95) earned.push(BADGES.EXCEPTIONAL);

	// Partnership badges
	if (forkData.partnerships >= 1) earned.push(BADGES.PARTNER_UP);
	if (forkData.partnerships >= 5) earned.push(BADGES.CONNECTED);

	// Onboarding badge
	if (forkData.onboardingComplete) earned.push(BADGES.ONBOARDED);

	// Streak/Activity badges
	if (forkData.activeMonthsStreak >= 3) earned.push(BADGES.ON_FIRE);

	// Attendance badges
	if (forkData.maxEventAttendance >= 100) earned.push(BADGES.PACKED_HOUSE);
	else if (forkData.maxEventAttendance >= 50) earned.push(BADGES.CROWD_PLEASER);

	return earned;
}

/**
 * Get badge by ID
 * @param {string} badgeId - Badge ID
 * @returns {Object|null} - Badge object or null
 */
function getBadgeById(badgeId) {
	return Object.values(BADGES).find(b => b.id === badgeId) || null;
}

/**
 * Format badge for display
 * @param {Object} badge - Badge object
 * @returns {string} - Formatted string
 */
function formatBadge(badge) {
	return `${badge.emoji} **${badge.name}** — ${badge.description}`;
}

/**
 * FORK LEVELS / BADGES based on total points
 * 0–100   → Seed Fork
 * 100–300 → Active Fork
 * 300–700 → High Impact Fork
 * 700+    → Elite Fork
 */
const FORK_LEVELS = {
	SEED: { id: 'seed', name: 'Seed Fork', minPoints: 0, maxPoints: 99, emoji: '🌱', color: '#81ECEC' },
	ACTIVE: { id: 'active', name: 'Active Fork', minPoints: 100, maxPoints: 299, emoji: '🌟', color: '#00FF95' },
	HIGH_IMPACT: { id: 'high_impact', name: 'High Impact Fork', minPoints: 300, maxPoints: 699, emoji: '💎', color: '#00F2FF' },
	ELITE: { id: 'elite', name: 'Elite Fork', minPoints: 700, maxPoints: Infinity, emoji: '👑', color: '#FFD700' },
};

/**
 * Get level from total points
 * @param {number} points - Total points
 * @returns {Object} - Level info { level, id, name, emoji, color, minPoints, maxPoints }
 */
function getLevelFromPoints(points) {
	if (points >= 700) {
		return { level: 4, ...FORK_LEVELS.ELITE };
	}
	if (points >= 300) {
		return { level: 3, ...FORK_LEVELS.HIGH_IMPACT };
	}
	if (points >= 100) {
		return { level: 2, ...FORK_LEVELS.ACTIVE };
	}
	return { level: 1, ...FORK_LEVELS.SEED };
}

/**
 * Get points needed for next level
 * @param {number} currentPoints - Current total points
 * @returns {Object} - { nextLevel, pointsNeeded, progress, currentLevel }
 */
function getProgressToNextLevel(currentPoints) {
	const thresholds = [100, 300, 700];
	const currentLevel = getLevelFromPoints(currentPoints);
	
	// If already at max level
	if (currentPoints >= 700) {
		return { 
			nextLevel: null, 
			pointsNeeded: 0, 
			progress: 100,
			currentLevel,
			isMaxLevel: true 
		};
	}
	
	for (let i = 0; i < thresholds.length; i++) {
		if (currentPoints < thresholds[i]) {
			const prevThreshold = i > 0 ? thresholds[i - 1] : 0;
			const progress = currentPoints - prevThreshold;
			const needed = thresholds[i] - prevThreshold;
			return {
				nextLevel: i + 2,
				pointsNeeded: thresholds[i] - currentPoints,
				progress: Math.round((progress / needed) * 100),
				currentLevel,
				nextThreshold: thresholds[i],
				isMaxLevel: false,
			};
		}
	}

	return { nextLevel: 4, pointsNeeded: 700 - currentPoints, progress: Math.round((currentPoints / 700) * 100), currentLevel, isMaxLevel: false };
}

module.exports = {
	POINTS,
	BADGES,
	FORK_LEVELS,
	calculateTotalPoints,
	calculateMonthlyPoints,
	determineBadges,
	getBadgeById,
	formatBadge,
	getLevelFromPoints,
	getProgressToNextLevel,
};
