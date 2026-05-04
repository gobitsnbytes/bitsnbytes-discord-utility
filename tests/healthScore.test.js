/**
 * Unit tests for lib/healthScore.js
 */

const {
	calculateHealthScore,
	getHealthStatus,
	rankForksByHealth,
	getAtRiskForks,
	getTopForks,
} = require('../lib/healthScore');

describe('calculateHealthScore', () => {
	test('should return 0 score for fork with no activity', () => {
		const fork = {
			properties: {},
		};

		const result = calculateHealthScore(fork);

		expect(result.score).toBe(0);
		expect(result.breakdown.pulseRecency).toBe(0);
		expect(result.breakdown.eventsConducted).toBe(0);
		expect(result.breakdown.teamCompleteness).toBe(0);
		expect(result.breakdown.reportSubmission).toBe(0);
		expect(result.breakdown.partnerships).toBe(0);
	});

	test('should calculate correct score for recent pulse (within 7 days)', () => {
		const recentDate = new Date();
		recentDate.setDate(recentDate.getDate() - 3); // 3 days ago

		const fork = {
			properties: {
				'Last Pulse': { date: { start: recentDate.toISOString() } },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.pulseRecency).toBe(25);
	});

	test('should calculate correct score for pulse 8-29 days old', () => {
		const date = new Date();
		date.setDate(date.getDate() - 15); // 15 days ago

		const fork = {
			properties: {
				'Last Pulse': { date: { start: date.toISOString() } },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.pulseRecency).toBe(15);
	});

	test('should calculate correct score for pulse 30-59 days old', () => {
		const date = new Date();
		date.setDate(date.getDate() - 45); // 45 days ago

		const fork = {
			properties: {
				'Last Pulse': { date: { start: date.toISOString() } },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.pulseRecency).toBe(5);
	});

	test('should calculate correct score for pulse 60+ days old', () => {
		const date = new Date();
		date.setDate(date.getDate() - 70); // 70 days ago

		const fork = {
			properties: {
				'Last Pulse': { date: { start: date.toISOString() } },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.pulseRecency).toBe(0);
	});

	test('should calculate events conducted score (max 25)', () => {
		const fork = {
			properties: {
				'Events Count': { number: 3 },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.eventsConducted).toBe(15); // 3 * 5 = 15
	});

	test('should cap events conducted score at 25', () => {
		const fork = {
			properties: {
				'Events Count': { number: 10 },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.eventsConducted).toBe(25);
	});

	test('should calculate team completeness score (max 20)', () => {
		const fork = {
			properties: {
				'Team Completeness': { number: 15 },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.teamCompleteness).toBe(15);
	});

	test('should cap team completeness score at 20', () => {
		const fork = {
			properties: {
				'Team Completeness': { number: 25 },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.teamCompleteness).toBe(20);
	});

	test('should calculate report submission score (max 15)', () => {
		const fork = {
			properties: {
				'Reports Submitted': { number: 2 },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.reportSubmission).toBe(10); // 2 * 5 = 10
	});

	test('should cap report submission score at 15', () => {
		const fork = {
			properties: {
				'Reports Submitted': { number: 5 },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.reportSubmission).toBe(15);
	});

	test('should calculate partnerships score (max 15)', () => {
		const fork = {
			properties: {
				'Partnerships Count': { number: 2 },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.breakdown.partnerships).toBe(10); // 2 * 5 = 10
	});

	test('should calculate total score correctly', () => {
		const recentDate = new Date();
		recentDate.setDate(recentDate.getDate() - 3);

		const fork = {
			properties: {
				'Last Pulse': { date: { start: recentDate.toISOString() } },
				'Events Count': { number: 3 },
				'Team Completeness': { number: 20 },
				'Reports Submitted': { number: 2 },
				'Partnerships Count': { number: 2 },
			},
		};

		const result = calculateHealthScore(fork);

		// 25 (pulse) + 15 (events) + 20 (team) + 10 (reports) + 10 (partnerships) = 80
		expect(result.score).toBe(80);
	});

	test('should cap total score at 100', () => {
		const recentDate = new Date();
		recentDate.setDate(recentDate.getDate() - 3);

		const fork = {
			properties: {
				'Last Pulse': { date: { start: recentDate.toISOString() } },
				'Events Count': { number: 10 },
				'Team Completeness': { number: 25 },
				'Reports Submitted': { number: 5 },
				'Partnerships Count': { number: 5 },
			},
		};

		const result = calculateHealthScore(fork);

		expect(result.score).toBe(100);
	});

	test('should handle fork with null properties', () => {
		const fork = null;

		// Should throw or handle gracefully
		expect(() => calculateHealthScore(fork)).toThrow();
	});

	test('should handle fork with undefined properties', () => {
		const fork = { properties: undefined };

		const result = calculateHealthScore(fork);

		expect(result.score).toBe(0);
	});
});

describe('getHealthStatus', () => {
	test('should return Excellent for score >= 80', () => {
		const result = getHealthStatus(85);

		expect(result.label).toBe('Excellent');
		expect(result.color).toBe('#00FF95');
		expect(result.emoji).toBe('💚');
	});

	test('should return Good for score 60-79', () => {
		const result = getHealthStatus(65);

		expect(result.label).toBe('Good');
		expect(result.color).toBe('#00F2FF');
		expect(result.emoji).toBe('💙');
	});

	test('should return Fair for score 40-59', () => {
		const result = getHealthStatus(45);

		expect(result.label).toBe('Fair');
		expect(result.color).toBe('#FFCC00');
		expect(result.emoji).toBe('💛');
	});

	test('should return At Risk for score 20-39', () => {
		const result = getHealthStatus(25);

		expect(result.label).toBe('At Risk');
		expect(result.color).toBe('#FF9900');
		expect(result.emoji).toBe('🧡');
	});

	test('should return Critical for score < 20', () => {
		const result = getHealthStatus(15);

		expect(result.label).toBe('Critical');
		expect(result.color).toBe('#FF0055');
		expect(result.emoji).toBe('❤️');
	});

	test('should handle edge case at 80', () => {
		const result = getHealthStatus(80);

		expect(result.label).toBe('Excellent');
	});

	test('should handle edge case at 60', () => {
		const result = getHealthStatus(60);

		expect(result.label).toBe('Good');
	});

	test('should handle edge case at 40', () => {
		const result = getHealthStatus(40);

		expect(result.label).toBe('Fair');
	});

	test('should handle edge case at 20', () => {
		const result = getHealthStatus(20);

		expect(result.label).toBe('At Risk');
	});

	test('should handle score of 0', () => {
		const result = getHealthStatus(0);

		expect(result.label).toBe('Critical');
	});

	test('should handle score of 100', () => {
		const result = getHealthStatus(100);

		expect(result.label).toBe('Excellent');
	});
});

describe('rankForksByHealth', () => {
	test('should filter only active forks', () => {
		const forks = [
			{ properties: { Status: { select: { name: 'Active' } } } },
			{ properties: { Status: { select: { name: 'Pending' } } } },
			{ properties: { Status: { select: { name: 'Archived' } } } },
		];

		const result = rankForksByHealth(forks);

		expect(result.length).toBe(1);
	});

	test('should sort forks by health score descending', () => {
		const recentDate = new Date();
		recentDate.setDate(recentDate.getDate() - 3);

		const forks = [
			{
				properties: {
					Status: { select: { name: 'Active' } },
					'Events Count': { number: 1 },
				},
			},
			{
				properties: {
					Status: { select: { name: 'Active' } },
					'Events Count': { number: 5 },
				},
			},
			{
				properties: {
					Status: { select: { name: 'Active' } },
					'Events Count': { number: 3 },
				},
			},
		];

		const result = rankForksByHealth(forks);

		expect(result[0].healthScore).toBeGreaterThanOrEqual(result[1].healthScore);
		expect(result[1].healthScore).toBeGreaterThanOrEqual(result[2].healthScore);
	});

	test('should include health status in result', () => {
		const forks = [
			{
				properties: {
					Status: { select: { name: 'Active' } },
					'Events Count': { number: 5 },
				},
			},
		];

		const result = rankForksByHealth(forks);

		expect(result[0]).toHaveProperty('healthScore');
		expect(result[0]).toHaveProperty('healthBreakdown');
		expect(result[0]).toHaveProperty('healthStatus');
		expect(result[0].healthStatus).toHaveProperty('label');
		expect(result[0].healthStatus).toHaveProperty('color');
		expect(result[0].healthStatus).toHaveProperty('emoji');
	});

	test('should return empty array for no active forks', () => {
		const forks = [
			{ properties: { Status: { select: { name: 'Pending' } } } },
			{ properties: { Status: { select: { name: 'Archived' } } } },
		];

		const result = rankForksByHealth(forks);

		expect(result).toEqual([]);
	});
});

describe('getAtRiskForks', () => {
	test('should return forks with score < 40', () => {
		const forksWithHealth = [
			{ healthScore: 25, fork: { id: '1' } },
			{ healthScore: 50, fork: { id: '2' } },
			{ healthScore: 35, fork: { id: '3' } },
			{ healthScore: 80, fork: { id: '4' } },
		];

		const result = getAtRiskForks(forksWithHealth);

		expect(result.length).toBe(2);
		expect(result[0].healthScore).toBe(25);
		expect(result[1].healthScore).toBe(35);
	});

	test('should return empty array when no forks at risk', () => {
		const forksWithHealth = [
			{ healthScore: 50, fork: { id: '1' } },
			{ healthScore: 80, fork: { id: '2' } },
		];

		const result = getAtRiskForks(forksWithHealth);

		expect(result).toEqual([]);
	});
});

describe('getTopForks', () => {
	test('should return top 5 forks by default', () => {
		const forksWithHealth = Array.from({ length: 10 }, (_, i) => ({
			healthScore: (10 - i) * 10,
			fork: { id: String(i) },
		}));

		const result = getTopForks(forksWithHealth);

		expect(result.length).toBe(5);
	});

	test('should return specified number of forks', () => {
		const forksWithHealth = Array.from({ length: 10 }, (_, i) => ({
			healthScore: (10 - i) * 10,
			fork: { id: String(i) },
		}));

		const result = getTopForks(forksWithHealth, 3);

		expect(result.length).toBe(3);
	});

	test('should return all forks if fewer than limit', () => {
		const forksWithHealth = [
			{ healthScore: 80, fork: { id: '1' } },
			{ healthScore: 60, fork: { id: '2' } },
		];

		const result = getTopForks(forksWithHealth, 5);

		expect(result.length).toBe(2);
	});

	test('should return empty array for empty input', () => {
		const result = getTopForks([]);

		expect(result).toEqual([]);
	});
});