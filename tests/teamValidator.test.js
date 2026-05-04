/**
 * Unit tests for lib/teamValidator.js
 */

const {
	REQUIRED_ROLES,
	VALID_ROLES,
	MAX_PER_ROLE,
	MAX_ROLES_PER_PERSON,
	validateTeam,
	getRoleEmoji,
	formatTeamDisplay,
	getTeamStats,
} = require('../lib/teamValidator');

describe('Constants', () => {
	test('REQUIRED_ROLES should contain Tech Lead, Creative Lead, Ops Lead', () => {
		expect(REQUIRED_ROLES).toContain('Tech Lead');
		expect(REQUIRED_ROLES).toContain('Creative Lead');
		expect(REQUIRED_ROLES).toContain('Ops Lead');
		expect(REQUIRED_ROLES.length).toBe(3);
	});

	test('VALID_ROLES should contain all required roles plus Volunteer and Member', () => {
		expect(VALID_ROLES).toContain('Tech Lead');
		expect(VALID_ROLES).toContain('Creative Lead');
		expect(VALID_ROLES).toContain('Ops Lead');
		expect(VALID_ROLES).toContain('Volunteer');
		expect(VALID_ROLES).toContain('Member');
	});

	test('MAX_PER_ROLE should be 3', () => {
		expect(MAX_PER_ROLE).toBe(3);
	});

	test('MAX_ROLES_PER_PERSON should be 2', () => {
		expect(MAX_ROLES_PER_PERSON).toBe(2);
	});
});

describe('validateTeam', () => {
	test('should return invalid for empty team', () => {
		const result = validateTeam([]);

		expect(result.isValid).toBe(false);
		expect(result.issues.length).toBe(3); // Missing all 3 required roles
		expect(result.completeness).toBe(0);
		expect(result.missingRoles).toEqual(expect.arrayContaining(['Tech Lead', 'Creative Lead', 'Ops Lead']));
	});

	test('should return valid for complete team with all required roles', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(true);
		expect(result.issues.length).toBe(0);
		expect(result.completeness).toBe(100);
		expect(result.completenessPoints).toBe(20);
		expect(result.missingRoles).toEqual([]);
	});

	test('should detect missing Tech Lead', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Creative Lead' },
			{ discordId: 'user2', role: 'Ops Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				type: 'missing_role',
				role: 'Tech Lead',
				severity: 'critical',
			})
		);
		expect(result.completeness).toBe(67); // 2/3 * 100, rounded
	});

	test('should detect missing Creative Lead', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Ops Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				type: 'missing_role',
				role: 'Creative Lead',
				severity: 'critical',
			})
		);
	});

	test('should detect missing Ops Lead', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				type: 'missing_role',
				role: 'Ops Lead',
				severity: 'critical',
			})
		);
	});

	test('should warn about overcrowded role', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Volunteer' },
			{ discordId: 'user5', role: 'Volunteer' },
			{ discordId: 'user6', role: 'Volunteer' },
			{ discordId: 'user7', role: 'Volunteer' }, // 4 volunteers - over limit
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(true);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				type: 'overcrowded_role',
				role: 'Volunteer',
				count: 4,
				severity: 'warning',
			})
		);
	});

	test('should warn about member with too many roles', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user1', role: 'Creative Lead' }, // Same person, 2nd role
			{ discordId: 'user1', role: 'Ops Lead' }, // Same person, 3rd role - over limit
		];

		const result = validateTeam(teamMembers);

		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				type: 'too_many_roles',
				discordId: 'user1',
				roleCount: 3,
				severity: 'warning',
			})
		);
	});

	test('should correctly count role occurrences', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Tech Lead' }, // 2 Tech Leads
			{ discordId: 'user3', role: 'Creative Lead' },
			{ discordId: 'user4', role: 'Ops Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.roleCounts['Tech Lead']).toBe(2);
		expect(result.roleCounts['Creative Lead']).toBe(1);
		expect(result.roleCounts['Ops Lead']).toBe(1);
	});

	test('should calculate completeness correctly for partial team', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.completeness).toBe(33); // 1/3 * 100, rounded
		expect(result.completenessPoints).toBe(7); // 1/3 * 20, rounded
	});

	test('should handle team with volunteers and members', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Volunteer' },
			{ discordId: 'user5', role: 'Member' },
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(true);
		expect(result.roleCounts['Volunteer']).toBe(1);
		expect(result.roleCounts['Member']).toBe(1);
	});

	test('should return correct filledRoles count', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.filledRoles).toBe(2);
		expect(result.totalRequiredRoles).toBe(3);
	});
});

describe('getRoleEmoji', () => {
	test('should return correct emoji for Tech Lead', () => {
		expect(getRoleEmoji('Tech Lead')).toBe('🎯');
	});

	test('should return correct emoji for Creative Lead', () => {
		expect(getRoleEmoji('Creative Lead')).toBe('🎨');
	});

	test('should return correct emoji for Ops Lead', () => {
		expect(getRoleEmoji('Ops Lead')).toBe('📋');
	});

	test('should return correct emoji for Volunteer', () => {
		expect(getRoleEmoji('Volunteer')).toBe('🤝');
	});

	test('should return correct emoji for Member', () => {
		expect(getRoleEmoji('Member')).toBe('👤');
	});

	test('should return default emoji for unknown role', () => {
		expect(getRoleEmoji('Unknown Role')).toBe('👤');
	});
});

describe('formatTeamDisplay', () => {
	test('should show all roles as MISSING for empty team', () => {
		const result = formatTeamDisplay([]);

		expect(result).toContain('🎯 **Tech Lead**: ⚠️ MISSING');
		expect(result).toContain('🎨 **Creative Lead**: ⚠️ MISSING');
		expect(result).toContain('📋 **Ops Lead**: ⚠️ MISSING');
	});

	test('should format complete team correctly', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
		];

		const result = formatTeamDisplay(teamMembers);

		expect(result).toContain('🎯 **Tech Lead**: <@user1> ✅');
		expect(result).toContain('🎨 **Creative Lead**: <@user2> ✅');
		expect(result).toContain('📋 **Ops Lead**: <@user3> ✅');
	});

	test('should show MISSING for unfilled required roles', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
		];

		const result = formatTeamDisplay(teamMembers);

		expect(result).toContain('🎯 **Tech Lead**: <@user1> ✅');
		expect(result).toContain('🎨 **Creative Lead**: ⚠️ MISSING');
		expect(result).toContain('📋 **Ops Lead**: ⚠️ MISSING');
	});

	test('should include volunteers and members', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Volunteer' },
			{ discordId: 'user5', role: 'Member' },
		];

		const result = formatTeamDisplay(teamMembers);

		expect(result).toContain('🤝 **Volunteer**: <@user4>');
		expect(result).toContain('👤 **Member**: <@user5>');
	});

	test('should handle multiple members in same role', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Tech Lead' },
			{ discordId: 'user3', role: 'Creative Lead' },
			{ discordId: 'user4', role: 'Ops Lead' },
		];

		const result = formatTeamDisplay(teamMembers);

		expect(result).toContain('🎯 **Tech Lead**: <@user1>, <@user2> ✅');
	});
});

describe('getTeamStats', () => {
	test('should return correct stats for empty team', () => {
		const result = getTeamStats([]);

		expect(result.totalMembers).toBe(0);
		expect(result.totalAssignments).toBe(0);
		expect(result.completeness).toBe(0);
		expect(result.missingRoles).toEqual(expect.arrayContaining(['Tech Lead', 'Creative Lead', 'Ops Lead']));
		expect(result.hasIssues).toBe(true);
		expect(result.hasWarnings).toBe(false);
	});

	test('should return correct stats for complete team', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
		];

		const result = getTeamStats(teamMembers);

		expect(result.totalMembers).toBe(3);
		expect(result.totalAssignments).toBe(3);
		expect(result.completeness).toBe(100);
		expect(result.missingRoles).toEqual([]);
		expect(result.hasIssues).toBe(false);
		expect(result.hasWarnings).toBe(false);
	});

	test('should count unique members correctly', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user1', role: 'Creative Lead' }, // Same user, different role
			{ discordId: 'user2', role: 'Ops Lead' },
		];

		const result = getTeamStats(teamMembers);

		expect(result.totalMembers).toBe(2); // 2 unique members
		expect(result.totalAssignments).toBe(3); // 3 role assignments
	});

	test('should detect warnings', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Volunteer' },
			{ discordId: 'user5', role: 'Volunteer' },
			{ discordId: 'user6', role: 'Volunteer' },
			{ discordId: 'user7', role: 'Volunteer' }, // Overcrowded
		];

		const result = getTeamStats(teamMembers);

		expect(result.hasWarnings).toBe(true);
	});

	test('should detect issues for incomplete team', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
		];

		const result = getTeamStats(teamMembers);

		expect(result.hasIssues).toBe(true);
	});
});