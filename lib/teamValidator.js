/**
 * 👥 TEAM STRUCTURE VALIDATOR
 * Validates fork team composition and identifies gaps
 */

// Required roles for a complete fork team
const REQUIRED_ROLES = ['Tech Lead', 'Creative Lead', 'Ops Lead', 'Outreach Lead'];

// All valid roles
const VALID_ROLES = [
	'Tech Lead', 'Creative Lead', 'Ops Lead', 'Outreach Lead',
	'Tech Contributor', 'Creative Contributor', 'Ops Contributor', 'Outreach Contributor',
	'Contributor',
	// Legacy roles
	'Volunteer', 'Tech Volunteer', 'Creative Volunteer', 'Ops Volunteer', 'Outreach Volunteer'
];

// Maximum people per role (to prevent overcrowding)
const MAX_PER_ROLE = 3;

// Maximum roles per person (to prevent role hoarding)
const MAX_ROLES_PER_PERSON = 2;

/**
 * Validate team structure for a fork
 * @param {Array} teamMembers - Array of team member objects
 * @returns {Object} - Validation result with issues and completeness
 */
function validateTeam(teamMembers) {
	const issues = [];
	const warnings = [];
	const roleCounts = {};
	const memberRoles = {};

	// Count roles and member assignments
	for (const member of teamMembers) {
		const role = member.role;
		const discordId = member.discordId;

		roleCounts[role] = (roleCounts[role] || 0) + 1;

		if (!memberRoles[discordId]) {
			memberRoles[discordId] = [];
		}
		memberRoles[discordId].push(role);
	}

	// Check for missing required roles
	for (const requiredRole of REQUIRED_ROLES) {
		if (!roleCounts[requiredRole] || roleCounts[requiredRole] === 0) {
			issues.push({
				type: 'missing_role',
				role: requiredRole,
				severity: 'critical',
				message: `Missing required role: ${requiredRole}`,
			});
		}
	}

	// Check for overcrowded roles
	for (const [role, count] of Object.entries(roleCounts)) {
		if (count > MAX_PER_ROLE) {
			warnings.push({
				type: 'overcrowded_role',
				role: role,
				count: count,
				severity: 'warning',
				message: `Role "${role}" has ${count} members (max recommended: ${MAX_PER_ROLE})`,
			});
		}
	}

	// Check for members with too many roles
	for (const [discordId, roles] of Object.entries(memberRoles)) {
		if (roles.length > MAX_ROLES_PER_PERSON) {
			warnings.push({
				type: 'too_many_roles',
				discordId: discordId,
				roleCount: roles.length,
				roles: roles,
				severity: 'warning',
				message: `Member <@${discordId}> has ${roles.length} roles (${roles.join(', ')})`,
			});
		}
	}

	// Calculate team completeness (percentage of required roles filled)
	const filledRoles = REQUIRED_ROLES.filter(role => roleCounts[role] > 0).length;
	const completeness = Math.round((filledRoles / REQUIRED_ROLES.length) * 100);
	const completenessPoints = Math.round((filledRoles / REQUIRED_ROLES.length) * 20); // Max 20 points

	return {
		isValid: issues.length === 0,
		issues,
		warnings,
		roleCounts,
		completeness,
		completenessPoints,
		filledRoles,
		totalRequiredRoles: REQUIRED_ROLES.length,
		missingRoles: REQUIRED_ROLES.filter(role => !roleCounts[role] || roleCounts[role] === 0),
	};
}

/**
 * Get role emoji for display
 * @param {string} role - Role name
 * @returns {string} - Emoji for the role
 */
function getRoleEmoji(role) {
	const emojis = {
		'Tech Lead': '🎯',
		'Creative Lead': '🎨',
		'Ops Lead': '📋',
		'Outreach Lead': '📢',
		'Tech Contributor': '💻',
		'Creative Contributor': '🖌️',
		'Ops Contributor': '⚙️',
		'Outreach Contributor': '📣',
		'Contributor': '🤝',
		'Volunteer': '🤝', // legacy
		'Tech Volunteer': '💻', // legacy
		'Creative Volunteer': '🖌️', // legacy
		'Ops Volunteer': '⚙️', // legacy
		'Outreach Volunteer': '📣', // legacy
	};
	return emojis[role] || '👤';
}

/**
 * Format team structure for display
 * @param {Array} teamMembers - Array of team member objects
 * @returns {string} - Formatted string for Discord
 */
function formatTeamDisplay(teamMembers) {
	const groupedByRole = {};

	for (const member of teamMembers) {
		if (!groupedByRole[member.role]) {
			groupedByRole[member.role] = [];
		}
		groupedByRole[member.role].push(member);
	}

	let display = '';

	// Show required roles first
	for (const role of REQUIRED_ROLES) {
		const emoji = getRoleEmoji(role);
		const members = groupedByRole[role] || [];

		if (members.length > 0) {
			const mentions = members.map(m => `<@${m.discordId}>`).join(', ');
			display += `${emoji} **${role}**: ${mentions} ✅\n`;
		} else {
			display += `${emoji} **${role}**: ⚠️ MISSING\n`;
		}
	}

	// Show other roles
	const otherRoles = [
		'Tech Contributor', 'Creative Contributor', 'Ops Contributor', 'Outreach Contributor',
		'Contributor', 'Volunteer',
		'Tech Volunteer', 'Creative Volunteer', 'Ops Volunteer', 'Outreach Volunteer'
	];
	for (const role of otherRoles) {
		const members = groupedByRole[role] || [];
		if (members.length > 0) {
			const emoji = getRoleEmoji(role);
			const mentions = members.map(m => `<@${m.discordId}>`).join(', ');
			display += `${emoji} **${role}**: ${mentions}\n`;
		}
	}

	return display || 'No team members assigned';
}

/**
 * Get team summary stats
 * @param {Array} teamMembers - Array of team member objects
 * @returns {Object} - Team statistics
 */
function getTeamStats(teamMembers) {
	const validation = validateTeam(teamMembers);
	const uniqueMembers = new Set(teamMembers.map(m => m.discordId));

	return {
		totalMembers: uniqueMembers.size,
		totalAssignments: teamMembers.length,
		completeness: validation.completeness,
		missingRoles: validation.missingRoles,
		hasIssues: validation.issues.length > 0,
		hasWarnings: validation.warnings.length > 0,
	};
}

module.exports = {
	REQUIRED_ROLES,
	VALID_ROLES,
	MAX_PER_ROLE,
	MAX_ROLES_PER_PERSON,
	validateTeam,
	getRoleEmoji,
	formatTeamDisplay,
	getTeamStats,
};