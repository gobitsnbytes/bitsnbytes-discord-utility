const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_FORK_REGISTRY_DB;
const eventsDbId = process.env.NOTION_EVENTS_DB;
const reportsDbId = process.env.NOTION_REPORTS_DB;
const teamDbId = process.env.NOTION_TEAM_DB;
const remindersDbId = process.env.NOTION_REMINDERS_DB;

/**
 * Helper to query a database
 */
async function queryDatabase(id, filter) {
	const params = { database_id: id };
	if (filter) params.filter = filter;

	// Preferred SDK method if available
	if (notion && notion.databases && typeof notion.databases.query === 'function') {
		const response = await notion.databases.query(params);
		return response.results;
	}

	// Fallback: use low-level request if SDK helper isn't present
	if (typeof notion.request === 'function') {
		const body = filter ? { filter } : {};
		const response = await notion.request({
			path: `/databases/${id}/query`,
			method: 'post',
			body,
		});
		return response.results || [];
	}

	throw new Error('Notion client does not support databases.query or request.');
}

module.exports = {
	async createForkRequest(data) {
		return await notion.pages.create({
			parent: { database_id: databaseId },
			properties: {
				'Name': { title: [{ text: { content: data.name } }] },
				'What city are you in?': { rich_text: [{ text: { content: data.city } }] },
				'Student': { select: { name: data.student ? 'Yes' : 'No' } },
				'About': { rich_text: [{ text: { content: data.about } }] },
				'Status': { select: { name: 'Pending' } },
                'Discord ID': { rich_text: [{ text: { content: data.userId } }] },
			},
		});
	},

	async updateForkStatus(pageId, status) {
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				'Status': { select: { name: status } },
			},
		});
	},

    async updatePulse(pageId, date) {
        return await notion.pages.update({
            page_id: pageId,
            properties: {
                'Last Pulse': { date: { start: date } },
            },
        });
    },

    async getForks() {
		return await queryDatabase(databaseId, {
			or: [
				{ property: 'Status', select: { equals: 'Active' } },
				{ property: 'Status', select: { equals: 'Pending' } },
			],
		});
    },

    async findForkByCity(city) {
		const results = await queryDatabase(databaseId, {
			property: 'What city are you in?',
			rich_text: { equals: city },
		});
		return results[0];
    },

	// ============================================
	// HEALTH & FORK PROPERTIES
	// ============================================

	async updateForkHealth(pageId, healthScore) {
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				'Health Score': { number: healthScore },
			},
		});
	},

	async incrementForkEvents(pageId) {
		const fork = await notion.pages.retrieve({ page_id: pageId });
		const currentCount = fork.properties['Events Count']?.number || 0;
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				'Events Count': { number: currentCount + 1 },
			},
		});
	},

	async incrementForkPartnerships(pageId) {
		const fork = await notion.pages.retrieve({ page_id: pageId });
		const currentCount = fork.properties['Partnerships Count']?.number || 0;
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				'Partnerships Count': { number: currentCount + 1 },
			},
		});
	},

	async incrementForkReports(pageId) {
		const fork = await notion.pages.retrieve({ page_id: pageId });
		const currentCount = fork.properties['Reports Submitted']?.number || 0;
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				'Reports Submitted': { number: currentCount + 1 },
			},
		});
	},

	async updateForkPoints(pageId, points) {
		const fork = await notion.pages.retrieve({ page_id: pageId });
		const currentPoints = fork.properties['Points']?.number || 0;
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				'Points': { number: currentPoints + points },
				'Monthly Points': { number: (fork.properties['Monthly Points']?.number || 0) + points },
			},
		});
	},

	// ============================================
	// ONBOARDING
	// ============================================

	async updateOnboardingStep(pageId, step, completed = true) {
		const stepField = `Onboarding Step ${step}`;
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				[stepField]: { checkbox: completed },
			},
		});
	},

	async getOnboardingStatus(pageId) {
		const fork = await notion.pages.retrieve({ page_id: pageId });
		const steps = [];
		for (let i = 1; i <= 7; i++) {
			const stepField = `Onboarding Step ${i}`;
			steps.push({
				step: i,
				completed: fork.properties[stepField]?.checkbox || false,
			});
		}
		return {
			steps,
			progress: steps.filter(s => s.completed).length,
			total: 7,
			percentage: Math.round((steps.filter(s => s.completed).length / 7) * 100),
		};
	},

	// ============================================
	// TEAM MEMBERS
	// ============================================

	async addTeamMember(forkId, discordId, role, name) {
		if (!teamDbId) {
			throw new Error('NOTION_TEAM_DB not configured');
		}
		return await notion.pages.create({
			parent: { database_id: teamDbId },
			properties: {
				'Name': { title: [{ text: { content: name || `Member ${discordId}` } }] },
				'Fork': { relation: [{ id: forkId }] },
				'Discord ID': { rich_text: [{ text: { content: discordId } }] },
				'Role': { select: { name: role } },
				'Joined Date': { date: { start: new Date().toISOString().split('T')[0] } },
			},
		});
	},

	async removeTeamMember(memberId) {
		if (!teamDbId) return;
		// Archive the page instead of deleting
		return await notion.pages.update({
			page_id: memberId,
			archived: true,
		});
	},

	async getTeamMembers(forkId) {
		if (!teamDbId) return [];
		const results = await queryDatabase(teamDbId, {
			property: 'Fork',
			relation: { contains: forkId },
		});
		return results.map(member => ({
			id: member.id,
			name: member.properties.Name?.title?.[0]?.text?.content || 'Unknown',
			discordId: member.properties['Discord ID']?.rich_text?.[0]?.text?.content,
			role: member.properties.Role?.select?.name,
			joinedDate: member.properties['Joined Date']?.date?.start,
		}));
	},

	async findTeamMember(forkId, discordId) {
		if (!teamDbId) return null;
		const results = await queryDatabase(teamDbId, {
			and: [
				{ property: 'Fork', relation: { contains: forkId } },
				{ property: 'Discord ID', rich_text: { equals: discordId } },
			],
		});
		return results[0];
	},

	async updateTeamMember(memberId, role, name) {
		if (!teamDbId) {
			throw new Error('NOTION_TEAM_DB not configured');
		}
		const properties = {};
		if (role) properties['Role'] = { select: { name: role } };
		if (name) properties['Name'] = { title: [{ text: { content: name } }] };
		
		return await notion.pages.update({
			page_id: memberId,
			properties,
		});
	},

	// ============================================
	// EVENTS
	// ============================================

	async createEvent(data) {
		if (!eventsDbId) {
			throw new Error('NOTION_EVENTS_DB not configured');
		}
		return await notion.pages.create({
			parent: { database_id: eventsDbId },
			properties: {
				'Event Name': { title: [{ text: { content: data.title } }] },
				'Fork': { relation: [{ id: data.forkId }] },
				'Date': { date: { start: data.date } },
				'Type': { select: { name: data.type } },
				'Status': { select: { name: 'Idea' } },
				'Description': { rich_text: [{ text: { content: data.description || '' } }] },
				'Expected Attendees': { number: data.expectedAttendees || 0 },
				'Created By': { rich_text: [{ text: { content: data.createdBy } }] },
			},
		});
	},

	async updateEvent(eventId, data) {
		const properties = {};
		if (data.status) properties['Status'] = { select: { name: data.status } };
		if (data.date) properties['Date'] = { date: { start: data.date } };
		if (data.attendees !== undefined) properties['Actual Attendees'] = { number: data.attendees };
		if (data.expectedAttendees !== undefined) properties['Expected Attendees'] = { number: data.expectedAttendees };
		if (data.description) properties['Description'] = { rich_text: [{ text: { content: data.description } }] };

		return await notion.pages.update({
			page_id: eventId,
			properties,
		});
	},

	async getEvents(forkId, status) {
		if (!eventsDbId) return [];
		const filters = [];
		if (forkId) {
			filters.push({ property: 'Fork', relation: { contains: forkId } });
		}
		if (status) {
			filters.push({ property: 'Status', select: { equals: status } });
		}

		const filter = filters.length > 1 ? { and: filters } : filters[0];
		const results = await queryDatabase(eventsDbId, filter);
		return results.map(event => ({
			id: event.id,
			title: event.properties['Event Name']?.title?.[0]?.text?.content || 'Untitled',
			forkId: event.properties.Fork?.relation?.[0]?.id,
			date: event.properties.Date?.date?.start,
			type: event.properties.Type?.select?.name,
			status: event.properties.Status?.select?.name,
			description: event.properties.Description?.rich_text?.[0]?.text?.content,
			expectedAttendees: event.properties['Expected Attendees']?.number,
			actualAttendees: event.properties['Actual Attendees']?.number,
		}));
	},

	async getUpcomingEvents(limit = 10) {
		if (!eventsDbId) return [];
		const today = new Date().toISOString().split('T')[0];
		const filter = {
			and: [
				{ property: 'Date', date: { on_or_after: today } },
				{ property: 'Status', select: { does_not_equal: 'Cancelled' } },
				{ property: 'Status', select: { does_not_equal: 'Completed' } },
			],
		};
		const results = await queryDatabase(eventsDbId, filter);
		return results.slice(0, limit).map(event => ({
			id: event.id,
			title: event.properties['Event Name']?.title?.[0]?.text?.content || 'Untitled',
			forkId: event.properties.Fork?.relation?.[0]?.id,
			date: event.properties.Date?.date?.start,
			type: event.properties.Type?.select?.name,
			status: event.properties.Status?.select?.name,
		}));
	},

	// ============================================
	// REPORTS
	// ============================================

	async createReport(data) {
		if (!reportsDbId) {
			throw new Error('NOTION_REPORTS_DB not configured');
		}
		return await notion.pages.create({
			parent: { database_id: reportsDbId },
			properties: {
				'Report Title': { title: [{ text: { content: `${data.type} — ${data.city || 'Fork'} — ${new Date().toISOString().split('T')[0]}` } }] },
				'Fork': { relation: [{ id: data.forkId }] },
				'Type': { select: { name: data.type } },
				'Submitted Date': { date: { start: new Date().toISOString().split('T')[0] } },
				'Attachment URL': { url: data.attachmentUrl || null },
				'Notes': { rich_text: [{ text: { content: data.notes || '' } }] },
				'Status': { select: { name: data.isLate ? 'late' : 'on-time' } },
			},
		});
	},

	async getReports(forkId) {
		if (!reportsDbId) return [];
		const filters = [];
		if (forkId) {
			filters.push({ property: 'Fork', relation: { contains: forkId } });
		}

		const filter = filters[0];
		const results = await queryDatabase(reportsDbId, filter);
		return results.map(report => ({
			id: report.id,
			forkId: report.properties.Fork?.relation?.[0]?.id,
			type: report.properties.Type?.select?.name,
			submittedDate: report.properties['Submitted Date']?.date?.start,
			attachmentUrl: report.properties['Attachment URL']?.url,
			notes: report.properties.Notes?.rich_text?.[0]?.text?.content,
			status: report.properties.Status?.select?.name,
		}));
	},

	async getRecentReports(forkId, limit = 5) {
		const reports = await this.getReports(forkId);
		return reports.slice(0, limit);
	},

	async updateReport(reportId, data) {
		if (!reportsDbId) {
			throw new Error('NOTION_REPORTS_DB not configured');
		}
		const properties = {};
		if (data.status) properties['Status'] = { select: { name: data.status } };
		if (data.notes) properties['Notes'] = { rich_text: [{ text: { content: data.notes } }] };
		if (data.attachmentUrl !== undefined) properties['Attachment URL'] = { url: data.attachmentUrl };
		
		return await notion.pages.update({
			page_id: reportId,
			properties,
		});
	},

	// ============================================
	// BADGES & GAMIFICATION
	// ============================================

	async computeAndUpdateTeamCompleteness(forkPageId) {
		try {
			const teamMembers = await this.getTeamMembers(forkPageId);
			const requiredRoles = ['tech-lead', 'creative-lead', 'ops-lead'];
			const filledRoles = new Set();

			teamMembers.forEach(member => {
				const roleLower = member.role?.toLowerCase();
				if (roleLower === 'tech lead') filledRoles.add('tech-lead');
				else if (roleLower === 'creative lead') filledRoles.add('creative-lead');
				else if (roleLower === 'ops lead') filledRoles.add('ops-lead');
			});

			let score = 0;
			const filledCount = filledRoles.size;
			if (filledCount === 3) score = 20;
			else if (filledCount === 2) score = 13;
			else if (filledCount === 1) score = 7;

			await notion.pages.update({
				page_id: forkPageId,
				properties: {
					'Team Completeness': { number: score },
				},
			});
		} catch (error) {
			console.error('[NOTION] Error updating team completeness:', error);
		}
	},

	async addBadgeToFork(pageId, badge) {
		const fork = await notion.pages.retrieve({ page_id: pageId });
		const currentBadges = fork.properties.Badges?.multi_select || [];
		const badgeExists = currentBadges.some(b => b.name === badge);
		if (!badgeExists) {
			return await notion.pages.update({
				page_id: pageId,
				properties: {
					'Badges': { multi_select: [...currentBadges, { name: badge }] },
				},
			});
		}
		return fork;
	},

	async getForkBadges(pageId) {
		const fork = await notion.pages.retrieve({ page_id: pageId });
		return fork.properties.Badges?.multi_select?.map(b => b.name) || [];
	},

	async resetMonthlyPoints(pageId) {
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				'Monthly Points': { number: 0 },
			},
		});
	},

	// ============================================
	// UTILITY
	// ============================================

	getDatabaseIds() {
		return {
			forkRegistry: databaseId,
			events: eventsDbId,
			reports: reportsDbId,
			team: teamDbId,
			reminders: remindersDbId,
		};
	},
};
