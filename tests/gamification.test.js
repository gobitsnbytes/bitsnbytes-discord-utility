/**
 * Unit tests for lib/gamification.js
 */

const {
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
} = require('../lib/gamification');

describe('POINTS Constants', () => {
	test('should have correct event points', () => {
		expect(POINTS.EVENT_CREATED).toBe(10);
		expect(POINTS.EVENT_APPROVED).toBe(20);
		expect(POINTS.EVENT_COMPLETED).toBe(50);
		expect(POINTS.EVENT_CANCELLED).toBe(-5);
		expect(POINTS.SPONSOR_SECURED).toBe(10);
	});

	test('should have correct engagement points', () => {
		expect(POINTS.REPORT_SUBMISSION).toBe(15);
		expect(POINTS.REPORT_ON_TIME).toBe(10);
		expect(POINTS.REPORT_LATE).toBe(-15);
		expect(POINTS.PULSE_SUBMITTED).toBe(10);
		expect(POINTS.PULSE_STREAK_WEEK).toBe(3);
		expect(POINTS.PULSE_OVERDUE).toBe(-2);
	});

	test('should have correct quality control points', () => {
		expect(POINTS.INACTIVE_2_WEEKS).toBe(-25);
	});

	test('should have correct team points', () => {
		expect(POINTS.TEAM_COMPLETE).toBe(5);
		expect(POINTS.TEAM_MEMBER_ADDED).toBe(1);
	});

	test('should have correct onboarding points', () => {
		expect(POINTS.ONBOARDING_COMPLETE).toBe(20);
	});

	test('should have correct partnership points', () => {
		expect(POINTS.PARTNERSHIP_ADDED).toBe(3);
	});

	test('should have correct special points', () => {
		expect(POINTS.MONTHLY_WINNER).toBe(50);
		expect(POINTS.HEALTH_SCORE_80).toBe(10);
		expect(POINTS.HEALTH_SCORE_90).toBe(20);
	});
});

describe('BADGES Constants', () => {
	test('should have event badges defined', () => {
		expect(BADGES.FIRST_EVENT).toBeDefined();
		expect(BADGES.FIRST_EVENT.id).toBe('first_event');
		expect(BADGES.EVENT_HERO.id).toBe('event_hero');
		expect(BADGES.EVENT_LEGEND.id).toBe('event_legend');
	});

	test('should have team badges defined', () => {
		expect(BADGES.TEAM_BUILDER).toBeDefined();
		expect(BADGES.RECRUITER).toBeDefined();
	});

	test('should have activity badges defined', () => {
		expect(BADGES.PULSE_MASTER).toBeDefined();
		expect(BADGES.REPORTER).toBeDefined();
	});

	test('should have health badges defined', () => {
		expect(BADGES.HEALTHY).toBeDefined();
		expect(BADGES.THRIVING).toBeDefined();
		expect(BADGES.EXCEPTIONAL).toBeDefined();
	});

	test('should have partnership badges defined', () => {
		expect(BADGES.PARTNER_UP).toBeDefined();
		expect(BADGES.CONNECTED).toBeDefined();
	});

	test('should have all required properties', () => {
		const badge = BADGES.FIRST_EVENT;
		expect(badge).toHaveProperty('id');
		expect(badge).toHaveProperty('name');
		expect(badge).toHaveProperty('emoji');
		expect(badge).toHaveProperty('description');
	});
});

describe('FORK_LEVELS Constants', () => {
	test('should have SEED level for 0-99 points', () => {
		expect(FORK_LEVELS.SEED.minPoints).toBe(0);
		expect(FORK_LEVELS.SEED.maxPoints).toBe(99);
		expect(FORK_LEVELS.SEED.emoji).toBe('🌱');
	});

	test('should have ACTIVE level for 100-299 points', () => {
		expect(FORK_LEVELS.ACTIVE.minPoints).toBe(100);
		expect(FORK_LEVELS.ACTIVE.maxPoints).toBe(299);
		expect(FORK_LEVELS.ACTIVE.emoji).toBe('🌟');
	});

	test('should have HIGH_IMPACT level for 300-699 points', () => {
		expect(FORK_LEVELS.HIGH_IMPACT.minPoints).toBe(300);
		expect(FORK_LEVELS.HIGH_IMPACT.maxPoints).toBe(699);
		expect(FORK_LEVELS.HIGH_IMPACT.emoji).toBe('💎');
	});

	test('should have ELITE level for 700+ points', () => {
		expect(FORK_LEVELS.ELITE.minPoints).toBe(700);
		expect(FORK_LEVELS.ELITE.maxPoints).toBe(Infinity);
		expect(FORK_LEVELS.ELITE.emoji).toBe('👑');
	});
});

describe('calculateTotalPoints', () => {
	test('should return 0 for empty fork data', () => {
		const result = calculateTotalPoints({});

		expect(result).toBe(0);
	});

	test('should return stored points when no health bonus', () => {
		const result = calculateTotalPoints({ points: 50 });

		expect(result).toBe(50);
	});

	test('should add health score 90 bonus', () => {
		const result = calculateTotalPoints({
			points: 100,
			health: { score: 92 },
		});

		expect(result).toBe(120); // 100 + 20
	});

	test('should add health score 80 bonus', () => {
		const result = calculateTotalPoints({
			points: 100,
			health: { score: 85 },
		});

		expect(result).toBe(110); // 100 + 10
	});

	test('should not add bonus for health score below 80', () => {
		const result = calculateTotalPoints({
			points: 100,
			health: { score: 70 },
		});

		expect(result).toBe(100);
	});

	test('should handle missing points property', () => {
		const result = calculateTotalPoints({
			health: { score: 90 },
		});

		expect(result).toBe(20); // Just health bonus
	});
});

describe('calculateMonthlyPoints', () => {
	test('should return 0 for empty activities', () => {
		const result = calculateMonthlyPoints({});

		expect(result).toBe(0);
	});

	test('should calculate report submission points', () => {
		const result = calculateMonthlyPoints({
			reportsThisMonth: 2,
		});

		expect(result).toBe(30); // 2 * 15
	});

	test('should calculate event completed points', () => {
		const result = calculateMonthlyPoints({
			eventsCompletedThisMonth: 3,
		});

		expect(result).toBe(150); // 3 * 50
	});

	test('should calculate pulse submitted points', () => {
		const result = calculateMonthlyPoints({
			pulsesThisMonth: 4,
		});

		expect(result).toBe(40); // 4 * 10
	});

	test('should add pulse streak bonus for 4+ weeks', () => {
		const result = calculateMonthlyPoints({
			pulsesThisMonth: 4,
			pulseStreak: 5,
		});

		expect(result).toBe(43); // 4 * 10 + 3 bonus
	});

	test('should not add pulse streak bonus for less than 4 weeks', () => {
		const result = calculateMonthlyPoints({
			pulsesThisMonth: 3,
			pulseStreak: 3,
		});

		expect(result).toBe(30); // Just 3 * 10, no bonus
	});

	test('should calculate partnership points', () => {
		const result = calculateMonthlyPoints({
			partnershipsThisMonth: 2,
		});

		expect(result).toBe(6); // 2 * 3
	});

	test('should calculate combined activities', () => {
		const result = calculateMonthlyPoints({
			reportsThisMonth: 1,
			eventsCompletedThisMonth: 1,
			pulsesThisMonth: 4,
			pulseStreak: 4,
			partnershipsThisMonth: 1,
		});

		// 15 (report) + 50 (event) + 40 (pulses) + 3 (streak) + 3 (partnership) = 111
		expect(result).toBe(111);
	});
});

describe('determineBadges', () => {
	test('should return empty array for new fork', () => {
		const result = determineBadges({});

		expect(result).toEqual([]);
	});

	test('should award FIRST_EVENT badge for 1 event', () => {
		const result = determineBadges({ totalEvents: 1 });

		expect(result).toContainEqual(BADGES.FIRST_EVENT);
	});

	test('should award EVENT_HERO badge for 5+ events', () => {
		const result = determineBadges({ totalEvents: 5 });

		expect(result).toContainEqual(BADGES.FIRST_EVENT);
		expect(result).toContainEqual(BADGES.EVENT_HERO);
	});

	test('should award EVENT_LEGEND badge for 10+ events', () => {
		const result = determineBadges({ totalEvents: 10 });

		expect(result).toContainEqual(BADGES.FIRST_EVENT);
		expect(result).toContainEqual(BADGES.EVENT_HERO);
		expect(result).toContainEqual(BADGES.EVENT_LEGEND);
	});

	test('should award TEAM_BUILDER badge for complete team', () => {
		const result = determineBadges({ teamComplete: true });

		expect(result).toContainEqual(BADGES.TEAM_BUILDER);
	});

	test('should award RECRUITER badge for 5+ team members', () => {
		const result = determineBadges({ teamMembersAdded: 5 });

		expect(result).toContainEqual(BADGES.RECRUITER);
	});

	test('should award PULSE_MASTER badge for 8+ week streak', () => {
		const result = determineBadges({ pulseStreak: 8 });

		expect(result).toContainEqual(BADGES.PULSE_MASTER);
	});

	test('should award REPORTER badge for 10+ on-time reports', () => {
		const result = determineBadges({ reportsOnTime: 10 });

		expect(result).toContainEqual(BADGES.REPORTER);
	});

	test('should award HEALTHY badge for health score 60+', () => {
		const result = determineBadges({ health: { score: 65 } });

		expect(result).toContainEqual(BADGES.HEALTHY);
	});

	test('should award THRIVING badge for health score 80+', () => {
		const result = determineBadges({ health: { score: 85 } });

		expect(result).toContainEqual(BADGES.HEALTHY);
		expect(result).toContainEqual(BADGES.THRIVING);
	});

	test('should award EXCEPTIONAL badge for health score 95+', () => {
		const result = determineBadges({ health: { score: 96 } });

		expect(result).toContainEqual(BADGES.HEALTHY);
		expect(result).toContainEqual(BADGES.THRIVING);
		expect(result).toContainEqual(BADGES.EXCEPTIONAL);
	});

	test('should award PARTNER_UP badge for 1 partnership', () => {
		const result = determineBadges({ partnerships: 1 });

		expect(result).toContainEqual(BADGES.PARTNER_UP);
	});

	test('should award CONNECTED badge for 5+ partnerships', () => {
		const result = determineBadges({ partnerships: 5 });

		expect(result).toContainEqual(BADGES.PARTNER_UP);
		expect(result).toContainEqual(BADGES.CONNECTED);
	});

	test('should award ONBOARDED badge for complete onboarding', () => {
		const result = determineBadges({ onboardingComplete: true });

		expect(result).toContainEqual(BADGES.ONBOARDED);
	});

	test('should award ON_FIRE badge for 3+ active months streak', () => {
		const result = determineBadges({ activeMonthsStreak: 3 });

		expect(result).toContainEqual(BADGES.ON_FIRE);
	});

	test('should award PACKED_HOUSE badge for 100+ attendance', () => {
		const result = determineBadges({ maxEventAttendance: 100 });

		expect(result).toContainEqual(BADGES.PACKED_HOUSE);
	});

	test('should award CROWD_PLEASER badge for 50+ attendance', () => {
		const result = determineBadges({ maxEventAttendance: 50 });

		expect(result).toContainEqual(BADGES.CROWD_PLEASER);
	});

	test('should not award CROWD_PLEASER when PACKED_HOUSE is earned', () => {
		const result = determineBadges({ maxEventAttendance: 100 });

		expect(result).toContainEqual(BADGES.PACKED_HOUSE);
		expect(result).not.toContainEqual(BADGES.CROWD_PLEASER);
	});
});

describe('getBadgeById', () => {
	test('should return badge for valid ID', () => {
		const result = getBadgeById('first_event');

		expect(result).toEqual(BADGES.FIRST_EVENT);
	});

	test('should return null for invalid ID', () => {
		const result = getBadgeById('nonexistent_badge');

		expect(result).toBeNull();
	});

	test('should find badge by ID correctly', () => {
		const result = getBadgeById('event_hero');

		expect(result.id).toBe('event_hero');
		expect(result.name).toBe('Event Hero');
	});
});

describe('formatBadge', () => {
	test('should format badge with emoji, name, and description', () => {
		const result = formatBadge(BADGES.FIRST_EVENT);

		expect(result).toBe('🎯 **First Steps** — Hosted first event');
	});

	test('should include correct emoji', () => {
		const result = formatBadge(BADGES.PULSE_MASTER);

		expect(result).toContain('💓');
	});
});

describe('getLevelFromPoints', () => {
	test('should return SEED level for 0 points', () => {
		const result = getLevelFromPoints(0);

		expect(result.level).toBe(1);
		expect(result.id).toBe('seed');
		expect(result.name).toBe('Seed Fork');
	});

	test('should return SEED level for 99 points', () => {
		const result = getLevelFromPoints(99);

		expect(result.level).toBe(1);
		expect(result.id).toBe('seed');
	});

	test('should return ACTIVE level for 100 points', () => {
		const result = getLevelFromPoints(100);

		expect(result.level).toBe(2);
		expect(result.id).toBe('active');
	});

	test('should return ACTIVE level for 299 points', () => {
		const result = getLevelFromPoints(299);

		expect(result.level).toBe(2);
		expect(result.id).toBe('active');
	});

	test('should return HIGH_IMPACT level for 300 points', () => {
		const result = getLevelFromPoints(300);

		expect(result.level).toBe(3);
		expect(result.id).toBe('high_impact');
	});

	test('should return HIGH_IMPACT level for 699 points', () => {
		const result = getLevelFromPoints(699);

		expect(result.level).toBe(3);
		expect(result.id).toBe('high_impact');
	});

	test('should return ELITE level for 700 points', () => {
		const result = getLevelFromPoints(700);

		expect(result.level).toBe(4);
		expect(result.id).toBe('elite');
	});

	test('should return ELITE level for 1000 points', () => {
		const result = getLevelFromPoints(1000);

		expect(result.level).toBe(4);
		expect(result.id).toBe('elite');
	});
});

describe('getProgressToNextLevel', () => {
	test('should return correct progress at 0 points', () => {
		const result = getProgressToNextLevel(0);

		expect(result.nextLevel).toBe(2);
		expect(result.pointsNeeded).toBe(100);
		expect(result.progress).toBe(0);
		expect(result.isMaxLevel).toBe(false);
	});

	test('should return correct progress at 50 points', () => {
		const result = getProgressToNextLevel(50);

		expect(result.nextLevel).toBe(2);
		expect(result.pointsNeeded).toBe(50);
		expect(result.progress).toBe(50);
	});

	test('should return correct progress at 100 points', () => {
		const result = getProgressToNextLevel(100);

		expect(result.nextLevel).toBe(3);
		expect(result.pointsNeeded).toBe(200);
		expect(result.progress).toBe(0);
	});

	test('should return correct progress at 200 points', () => {
		const result = getProgressToNextLevel(200);

		expect(result.nextLevel).toBe(3);
		expect(result.pointsNeeded).toBe(100);
		expect(result.progress).toBe(50);
	});

	test('should return correct progress at 300 points', () => {
		const result = getProgressToNextLevel(300);

		expect(result.nextLevel).toBe(4);
		expect(result.pointsNeeded).toBe(400);
		expect(result.progress).toBe(0);
	});

	test('should return correct progress at 500 points', () => {
		const result = getProgressToNextLevel(500);

		expect(result.nextLevel).toBe(4);
		expect(result.pointsNeeded).toBe(200);
		expect(result.progress).toBeGreaterThan(0);
	});

	test('should return max level at 700 points', () => {
		const result = getProgressToNextLevel(700);

		expect(result.isMaxLevel).toBe(true);
		expect(result.nextLevel).toBeNull();
		expect(result.pointsNeeded).toBe(0);
		expect(result.progress).toBe(100);
	});

	test('should return max level for points above 700', () => {
		const result = getProgressToNextLevel(1000);

		expect(result.isMaxLevel).toBe(true);
		expect(result.progress).toBe(100);
	});

	test('should include currentLevel in result', () => {
		const result = getProgressToNextLevel(150);

		expect(result.currentLevel).toBeDefined();
		expect(result.currentLevel.id).toBe('active');
	});

	test('should include nextThreshold when not max level', () => {
		const result = getProgressToNextLevel(50);

		expect(result.nextThreshold).toBe(100);
	});
});