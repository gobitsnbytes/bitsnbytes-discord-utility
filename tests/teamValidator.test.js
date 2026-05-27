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
	test('REQUIRED_ROLES should contain Tech Lead, Creative Lead, Ops Lead, Outreach Lead', () => {
		expect(REQUIRED_ROLES).toContain('Tech Lead');
		expect(REQUIRED_ROLES).toContain('Creative Lead');
		expect(REQUIRED_ROLES).toContain('Ops Lead');
		expect(REQUIRED_ROLES).toContain('Outreach Lead');
		expect(REQUIRED_ROLES.length).toBe(4);
	});

	test('VALID_ROLES should contain all required roles plus Contributor and Volunteer', () => {
		expect(VALID_ROLES).toContain('Tech Lead');
		expect(VALID_ROLES).toContain('Creative Lead');
		expect(VALID_ROLES).toContain('Ops Lead');
		expect(VALID_ROLES).toContain('Outreach Lead');
		expect(VALID_ROLES).toContain('Contributor');
		expect(VALID_ROLES).toContain('Volunteer');
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
		expect(result.issues.length).toBe(4); // Missing all 4 required roles
		expect(result.completeness).toBe(0);
		expect(result.missingRoles).toEqual(expect.arrayContaining(['Tech Lead', 'Creative Lead', 'Ops Lead', 'Outreach Lead']));
	});

	test('should return valid for complete team with all required roles', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Outreach Lead' },
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
			{ discordId: 'user3', role: 'Outreach Lead' },
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
		expect(result.completeness).toBe(75); // 3/4 * 100
	});

	test('should detect missing Creative Lead', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Ops Lead' },
			{ discordId: 'user3', role: 'Outreach Lead' },
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
			{ discordId: 'user3', role: 'Outreach Lead' },
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

	test('should detect missing Outreach Lead', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				type: 'missing_role',
				role: 'Outreach Lead',
				severity: 'critical',
			})
		);
	});

	test('should warn about overcrowded role', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Outreach Lead' },
			{ discordId: 'user5', role: 'Contributor' },
			{ discordId: 'user6', role: 'Contributor' },
			{ discordId: 'user7', role: 'Contributor' },
			{ discordId: 'user8', role: 'Contributor' }, // 4 contributors - over limit
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(true);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				type: 'overcrowded_role',
				role: 'Contributor',
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
			{ discordId: 'user5', role: 'Outreach Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.roleCounts['Tech Lead']).toBe(2);
		expect(result.roleCounts['Creative Lead']).toBe(1);
		expect(result.roleCounts['Ops Lead']).toBe(1);
		expect(result.roleCounts['Outreach Lead']).toBe(1);
	});

	test('should calculate completeness correctly for partial team', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.completeness).toBe(25); // 1/4 * 100
		expect(result.completenessPoints).toBe(5); // 1/4 * 20
	});

	test('should handle team with contributors and legacy volunteers', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Outreach Lead' },
			{ discordId: 'user5', role: 'Contributor' },
			{ discordId: 'user6', role: 'Volunteer' },
		];

		const result = validateTeam(teamMembers);

		expect(result.isValid).toBe(true);
		expect(result.roleCounts['Contributor']).toBe(1);
		expect(result.roleCounts['Volunteer']).toBe(1);
	});

	test('should return correct filledRoles count', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
		];

		const result = validateTeam(teamMembers);

		expect(result.filledRoles).toBe(2);
		expect(result.totalRequiredRoles).toBe(4);
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

	test('should return correct emoji for Outreach Lead', () => {
		expect(getRoleEmoji('Outreach Lead')).toBe('📢');
	});

	test('should return correct emoji for Contributor', () => {
		expect(getRoleEmoji('Contributor')).toBe('🤝');
	});

	test('should return correct emoji for Volunteer', () => {
		expect(getRoleEmoji('Volunteer')).toBe('🤝');
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
		expect(result).toContain('📢 **Outreach Lead**: ⚠️ MISSING');
	});

	test('should format complete team correctly', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Outreach Lead' },
		];

		const result = formatTeamDisplay(teamMembers);

		expect(result).toContain('🎯 **Tech Lead**: <@user1> ✅');
		expect(result).toContain('🎨 **Creative Lead**: <@user2> ✅');
		expect(result).toContain('📋 **Ops Lead**: <@user3> ✅');
		expect(result).toContain('📢 **Outreach Lead**: <@user4> ✅');
	});

	test('should show MISSING for unfilled required roles', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
		];

		const result = formatTeamDisplay(teamMembers);

		expect(result).toContain('🎯 **Tech Lead**: <@user1> ✅');
		expect(result).toContain('🎨 **Creative Lead**: ⚠️ MISSING');
		expect(result).toContain('📋 **Ops Lead**: ⚠️ MISSING');
		expect(result).toContain('📢 **Outreach Lead**: ⚠️ MISSING');
	});

	test('should include contributors and legacy volunteers', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Outreach Lead' },
			{ discordId: 'user5', role: 'Contributor' },
			{ discordId: 'user6', role: 'Volunteer' },
		];

		const result = formatTeamDisplay(teamMembers);

		expect(result).toContain('🤝 **Contributor**: <@user5>');
		expect(result).toContain('🤝 **Volunteer**: <@user6>');
	});

	test('should handle multiple members in same role', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Tech Lead' },
			{ discordId: 'user3', role: 'Creative Lead' },
			{ discordId: 'user4', role: 'Ops Lead' },
			{ discordId: 'user5', role: 'Outreach Lead' },
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
		expect(result.missingRoles).toEqual(expect.arrayContaining(['Tech Lead', 'Creative Lead', 'Ops Lead', 'Outreach Lead']));
		expect(result.hasIssues).toBe(true);
		expect(result.hasWarnings).toBe(false);
	});

	test('should return correct stats for complete team', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Outreach Lead' },
		];

		const result = getTeamStats(teamMembers);

		expect(result.totalMembers).toBe(4);
		expect(result.totalAssignments).toBe(4);
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
			{ discordId: 'user3', role: 'Outreach Lead' },
		];

		const result = getTeamStats(teamMembers);

		expect(result.totalMembers).toBe(3); // 3 unique members
		expect(result.totalAssignments).toBe(4); // 4 role assignments
	});

	test('should detect warnings', () => {
		const teamMembers = [
			{ discordId: 'user1', role: 'Tech Lead' },
			{ discordId: 'user2', role: 'Creative Lead' },
			{ discordId: 'user3', role: 'Ops Lead' },
			{ discordId: 'user4', role: 'Outreach Lead' },
			{ discordId: 'user5', role: 'Contributor' },
			{ discordId: 'user6', role: 'Contributor' },
			{ discordId: 'user7', role: 'Contributor' },
			{ discordId: 'user8', role: 'Contributor' }, // Overcrowded
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