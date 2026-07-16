const { Client } = require('@notionhq/client');
require('dotenv').config();
const db = require('./db');

// Request retry helper
async function requestWithRetry(fn, retries = 3, delay = 1000) {
	try {
		return await fn();
	} catch (err) {
		const status = err.status || err.statusCode;
		const isRateLimit = status === 429 || err.code === 'rate_limit_reached';
		const isTransient = (status >= 500 && status < 600) || err.code === 'internal_server_error';
		if ((isRateLimit || isTransient) && retries > 0) {
			const backoff = isRateLimit 
				? parseInt(err.headers?.['retry-after'] || '2', 10) * 1000 
				: delay * 2;
			console.warn(`[NOTION_RETRY] Rate limited or transient error. Retrying in ${backoff}ms... (${retries} retries left). Error: ${err.message}`);
			await new Promise(resolve => setTimeout(resolve, backoff));
			return requestWithRetry(fn, retries - 1, backoff);
		}
		throw err;
	}
}

// Recursive proxy handler to wrap all method calls
function createProxy(obj) {
	return new Proxy(obj, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value === 'function') {
				return function (...args) {
					// Only retry async methods that return a Promise (like API calls)
					const result = value.apply(target, args);
					if (result instanceof Promise) {
						return requestWithRetry(() => result);
					}
					return result;
				};
			} else if (value && typeof value === 'object') {
				return createProxy(value);
			}
			return value;
		}
	});
}

// Notion Client (Core Fork Registry)
const rawNotion = new Client({ auth: process.env.NOTION_TOKEN });
const notion = createProxy(rawNotion);
const databaseId = process.env.NOTION_FORK_REGISTRY_DB;
const remindersDatabaseId = process.env.NOTION_REMINDERS_DB;

// Promisified DB helpers
function dbRun(sql, params = []) {
	return db.run(sql, params);
}

function dbGet(sql, params = []) {
	return db.get(sql, params);
}

function dbAll(sql, params = []) {
	return db.all(sql, params);
}

// Initialize tables
if (process.env.NODE_ENV === 'test' || !db.usePostgres) {
	db.serialize(async () => {
		try {
			await dbRun(`
				CREATE TABLE IF NOT EXISTS team_members (
					id TEXT PRIMARY KEY,
					fork_id TEXT NOT NULL,
					discord_id TEXT NOT NULL,
					role TEXT NOT NULL,
					name TEXT,
					joined_date TEXT NOT NULL
				)
			`);

			await dbRun(`
				CREATE TABLE IF NOT EXISTS events (
					id TEXT PRIMARY KEY,
					title TEXT NOT NULL,
					fork_id TEXT NOT NULL,
					date TEXT NOT NULL,
					type TEXT NOT NULL,
					status TEXT NOT NULL,
					description TEXT,
					expected_attendees INTEGER DEFAULT 0,
					actual_attendees INTEGER DEFAULT 0,
					created_by TEXT,
					calcom_booking_id TEXT,
					calcom_uid TEXT
				)
			`);

			await dbRun(`
				CREATE TABLE IF NOT EXISTS reports (
					id TEXT PRIMARY KEY,
					fork_id TEXT NOT NULL,
					type TEXT NOT NULL,
					submitted_date TEXT NOT NULL,
					attachment_url TEXT,
					notes TEXT,
					status TEXT NOT NULL
				)
			`);
		} catch (err) {
			console.error("[NOTION_DB] Schema initialization error:", err);
		}
	});
}

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

	// Fallback: make a direct HTTPS call to Notion REST API
	const https = require('https');
	const body = filter ? { filter } : {};
	const postData = JSON.stringify(body);

	const options = {
		hostname: 'api.notion.com',
		port: 443,
		path: `/v1/databases/${id}/query`,
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
			'Notion-Version': process.env.NOTION_VERSION || '2022-06-28',
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(postData),
		},
	};

	const response = await requestWithRetry(async () => {
		return new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				let data = '';
				res.on('data', (chunk) => { data += chunk; });
				res.on('end', () => {
					try {
						const parsed = JSON.parse(data || '{}');
						resolve(parsed);
					} catch (e) {
						reject(e);
					}
				});
			});
			req.on('error', (e) => reject(e));
			req.write(postData);
			req.end();
		});
	});

	return response.results || [];
}

module.exports = {
	// ============================================
	// CORE FORK REGISTRY (NOTION)
	// ============================================

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

	async updateForkStatus(pageId, status, discordId = null) {
		const properties = {
			'Status': { select: { name: status } },
		};
		if (discordId !== null) {
			properties['Discord ID'] = { rich_text: [{ text: { content: discordId } }] };
		}
		return await notion.pages.update({
			page_id: pageId,
			properties,
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
		if (!databaseId) {
			throw new Error('NOTION_FORK_REGISTRY_DB not configured');
		}
		return await queryDatabase(databaseId, {
			or: [
				{ property: 'Status', select: { equals: 'Active' } },
				{ property: 'Status', select: { equals: 'Pending' } },
			],
		});
	},

	async findForkByCity(city) {
		if (!city) return null;
		const forks = await this.getForks();
		const cleanQuery = city.trim().toLowerCase();
		
		return forks.find(f => {
			const forkCity = f.properties?.['What city are you in?']?.rich_text?.[0]?.text?.content;
			const forkName = f.properties?.['Fork Name']?.title?.[0]?.text?.content;
			
			if (forkCity && forkCity.trim().toLowerCase() === cleanQuery) return true;
			if (forkName) {
				const cleanName = forkName.replace(/^bits\s*&\s*bytes\s+/i, '').trim().toLowerCase();
				if (cleanName === cleanQuery) return true;
			}
			return false;
		}) || null;
	},

	// ============================================
	// HEALTH & FORK PROPERTIES (NOTION)
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
	// ONBOARDING (NOTION)
	// ============================================

	async updateOnboardingStep(pageId, step, completed = true) {
		const stepField = `Onboarding Step ${step}`;
		try {
			return await notion.pages.update({
				page_id: pageId,
				properties: {
					[stepField]: { checkbox: completed },
				},
			});
		} catch (error) {
			if (error.code === 'validation_error' && error.message.includes('not a property that exists')) {
				throw new Error(`The Notion database is missing the required property: "${stepField}". Please add it as a Checkbox property in the Fork Registry.`);
			}
			throw error;
		}
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
	// TEAM MEMBERS (SQLITE)
	// ============================================

	async addTeamMember(forkId, discordId, role, name) {
		const id = `tm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const joinedDate = new Date().toISOString().split('T')[0];
		await dbRun(
			`INSERT INTO team_members (id, fork_id, discord_id, role, name, joined_date)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[id, forkId, discordId, role, name || `Member ${discordId}`, joinedDate]
		);
		return { id };
	},

	async removeTeamMember(memberId) {
		await dbRun(`DELETE FROM team_members WHERE id = ?`, [memberId]);
		return { id: memberId };
	},

	async getTeamMembers(forkId) {
		const rows = await dbAll(`SELECT * FROM team_members WHERE fork_id = ?`, [forkId]);
		return rows.map(r => ({
			id: r.id,
			name: r.name || 'Unknown',
			discordId: r.discord_id,
			role: r.role,
			joinedDate: r.joined_date,
		}));
	},

	async findTeamMember(forkId, discordId) {
		const row = await dbGet(
			`SELECT * FROM team_members WHERE fork_id = ? AND discord_id = ? LIMIT 1`,
			[forkId, discordId]
		);
		if (!row) return null;
		return {
			id: row.id,
			properties: {
				'Name': { title: [{ text: { content: row.name || '' } }] },
				'Role': { select: { name: row.role } },
				'Discord ID': { rich_text: [{ text: { content: row.discord_id } }] },
			}
		};
	},

	async updateTeamMember(memberId, role, name) {
		if (role && name) {
			await dbRun(`UPDATE team_members SET role = ?, name = ? WHERE id = ?`, [role, name, memberId]);
		} else if (role) {
			await dbRun(`UPDATE team_members SET role = ? WHERE id = ?`, [role, memberId]);
		} else if (name) {
			await dbRun(`UPDATE team_members SET name = ? WHERE id = ?`, [name, memberId]);
		}
		return { id: memberId };
	},

	async computeAndUpdateTeamCompleteness(forkPageId) {
		try {
			const teamMembers = await this.getTeamMembers(forkPageId);
			const requiredRoles = ['tech-lead', 'creative-lead', 'ops-lead', 'outreach-lead'];
			const filledRoles = new Set();

			teamMembers.forEach(member => {
				const roleLower = member.role?.toLowerCase();
				if (roleLower === 'tech lead' || roleLower === 'tech head') filledRoles.add('tech-lead');
				else if (roleLower === 'creative lead' || roleLower === 'creative head') filledRoles.add('creative-lead');
				else if (roleLower === 'ops lead' || roleLower === 'ops head') filledRoles.add('ops-lead');
				else if (roleLower === 'outreach lead' || roleLower === 'outreach head') filledRoles.add('outreach-lead');
			});

			let score = 0;
			const filledCount = filledRoles.size;
			if (filledCount === 4) score = 20;
			else if (filledCount === 3) score = 15;
			else if (filledCount === 2) score = 10;
			else if (filledCount === 1) score = 5;

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

	// ============================================
	// EVENTS (SQLITE)
	// ============================================

	async createEvent(data) {
		const id = data.id || `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		await dbRun(
			`INSERT INTO events (id, title, fork_id, date, type, status, description, expected_attendees, actual_attendees, created_by, calcom_booking_id, calcom_uid)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				data.title,
				data.forkId,
				data.date,
				data.type,
				'Idea',
				data.description || '',
				data.expectedAttendees || 0,
				0,
				data.createdBy || '',
				data.calcomBookingId || null,
				data.calcomUid || null,
			]
		);
		return { id };
	},

	async updateEvent(eventId, data) {
		const updates = [];
		const params = [];
		if (data.status) {
			updates.push('status = ?');
			params.push(data.status);
		}
		if (data.date) {
			updates.push('date = ?');
			params.push(data.date);
		}
		if (data.attendees !== undefined) {
			updates.push('actual_attendees = ?');
			params.push(data.attendees);
		}
		if (data.expectedAttendees !== undefined) {
			updates.push('expected_attendees = ?');
			params.push(data.expectedAttendees);
		}
		if (data.description) {
			updates.push('description = ?');
			params.push(data.description);
		}
		if (data.calcomBookingId !== undefined) {
			updates.push('calcom_booking_id = ?');
			params.push(data.calcomBookingId);
		}
		if (data.calcomUid !== undefined) {
			updates.push('calcom_uid = ?');
			params.push(data.calcomUid);
		}

		if (updates.length > 0) {
			params.push(eventId);
			await dbRun(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`, params);
		}
		return { id: eventId };
	},

	async getEvents(forkId, status) {
		let query = 'SELECT * FROM events WHERE 1=1';
		const params = [];
		if (forkId) {
			query += ' AND fork_id = ?';
			params.push(forkId);
		}
		if (status) {
			query += ' AND status = ?';
			params.push(status);
		}
		query += ' ORDER BY date DESC';

		const rows = await dbAll(query, params);
		return rows.map(r => ({
			id: r.id,
			title: r.title || 'Untitled',
			forkId: r.fork_id,
			date: r.date,
			type: r.type,
			status: r.status,
			description: r.description,
			expectedAttendees: r.expected_attendees,
			actualAttendees: r.actual_attendees,
			calcomBookingId: r.calcom_booking_id || null,
			calcomUid: r.calcom_uid || null,
		}));
	},

	async getUpcomingEvents(limit = 10) {
		const today = new Date().toISOString().split('T')[0];
		const rows = await dbAll(
			`SELECT * FROM events 
			 WHERE date >= ? AND status != 'Cancelled' AND status != 'Completed' 
			 ORDER BY date ASC LIMIT ?`,
			[today, limit]
		);
		return rows.map(r => ({
			id: r.id,
			title: r.title || 'Untitled',
			forkId: r.fork_id,
			date: r.date,
			type: r.type,
			status: r.status,
		}));
	},

	// ============================================
	// REPORTS (SQLITE)
	// ============================================

	async createReport(data) {
		const id = `rep_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const submittedDate = new Date().toISOString().split('T')[0];
		await dbRun(
			`INSERT INTO reports (id, fork_id, type, submitted_date, attachment_url, notes, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				data.forkId,
				data.type,
				submittedDate,
				data.attachmentUrl || null,
				data.notes || '',
				data.isLate ? 'late' : 'on-time',
			]
		);
		return { id };
	},

	async getReports(forkId) {
		let query = 'SELECT * FROM reports WHERE 1=1';
		const params = [];
		if (forkId) {
			query += ' AND fork_id = ?';
			params.push(forkId);
		}
		query += ' ORDER BY submitted_date DESC';

		const rows = await dbAll(query, params);
		return rows.map(r => ({
			id: r.id,
			forkId: r.fork_id,
			type: r.type,
			submittedDate: r.submitted_date,
			attachmentUrl: r.attachment_url,
			notes: r.notes,
			status: r.status,
		}));
	},

	async getRecentReports(forkId, limit = 5) {
		const reports = await this.getReports(forkId);
		return reports.slice(0, limit);
	},

	async updateReport(reportId, data) {
		const updates = [];
		const params = [];
		if (data.status) {
			updates.push('status = ?');
			params.push(data.status);
		}
		if (data.notes) {
			updates.push('notes = ?');
			params.push(data.notes);
		}
		if (data.attachmentUrl !== undefined) {
			updates.push('attachment_url = ?');
			params.push(data.attachmentUrl);
		}

		if (updates.length > 0) {
			params.push(reportId);
			await dbRun(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`, params);
		}
		return { id: reportId };
	},

	// ============================================
	// BADGES & GAMIFICATION (NOTION)
	// ============================================

	async addBadgeToFork(pageId, badge) {
		const fork = await notion.pages.retrieve({ page_id: pageId });
		const currentBadges = fork.properties.Badges?.multi_select || [];
		const gamification = require('./gamification');
		const badgeObj = gamification.getBadgeById(badge) || { name: badge, emoji: '' };
		const badgeName = badgeObj.emoji ? `${badgeObj.emoji} ${badgeObj.name}` : badgeObj.name;

		const badgeExists = currentBadges.some(b => b.name === badgeName);
		if (!badgeExists) {
			return await notion.pages.update({
				page_id: pageId,
				properties: {
					'Badges': { multi_select: [...currentBadges, { name: badgeName }] },
				},
			});
		}
		return fork;
	},

	async updateForkBadges(pageId, badgeIds) {
		const gamification = require('./gamification');
		const badgeObjects = badgeIds.map(id => {
			const badgeObj = gamification.getBadgeById(id);
			const badgeName = badgeObj ? (badgeObj.emoji ? `${badgeObj.emoji} ${badgeObj.name}` : badgeObj.name) : id;
			return { name: badgeName };
		});
		return await notion.pages.update({
			page_id: pageId,
			properties: {
				'Badges': { multi_select: badgeObjects },
			},
		});
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

	getCityName(fork) {
		if (!fork) return 'UNKNOWN';
		const forkCity = fork.properties?.['What city are you in?']?.rich_text?.[0]?.text?.content;
		const forkName = fork.properties?.['Fork Name']?.title?.[0]?.text?.content;
		if (forkCity) return forkCity.trim();
		if (forkName) {
			return forkName.replace(/^bits\s*&\s*bytes\s+/i, '').trim();
		}
		return 'UNKNOWN';
	},

	getLeadDiscordId(fork) {
		if (!fork) return null;
		const rawId = fork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
		return rawId ? rawId.replace(/\D/g, '') : null;
	},

	async getSentReminder(forkId, reminderType) {
		if (!remindersDatabaseId) return null;
		try {
			const results = await queryDatabase(remindersDatabaseId, {
				and: [
					{
						property: 'Fork',
						relation: {
							contains: forkId
						}
					},
					{
						property: 'Reminder Type',
						select: {
							equals: reminderType
						}
					}
				]
			});
			if (results.length === 0) return null;
			const lastSentStr = results[0].properties['Last Sent']?.date?.start;
			return lastSentStr ? new Date(lastSentStr).getTime() : null;
		} catch (err) {
			console.warn(`[NOTION] Failed to fetch sent reminder for ${forkId}:`, err.message);
			return null;
		}
	},

	async recordSentReminder(forkId, reminderType) {
		if (!remindersDatabaseId) return;
		try {
			const results = await queryDatabase(remindersDatabaseId, {
				and: [
					{
						property: 'Fork',
						relation: {
							contains: forkId
						}
					},
					{
						property: 'Reminder Type',
						select: {
							equals: reminderType
						}
					}
				]
			});
			const nowStr = new Date().toISOString();
			if (results.length > 0) {
				await notion.pages.update({
					page_id: results[0].id,
					properties: {
						'Last Sent': { date: { start: nowStr } },
						'Is Active': { checkbox: true }
					}
				});
			} else {
				await notion.pages.create({
					parent: { database_id: remindersDatabaseId },
					properties: {
						'Name': { title: [{ text: { content: `${reminderType} - ${forkId}` } }] },
						'Fork': { relation: [{ id: forkId }] },
						'Reminder Type': { select: { name: reminderType } },
						'Last Sent': { date: { start: nowStr } },
						'Is Active': { checkbox: true }
					}
				});
			}
		} catch (err) {
			console.warn(`[NOTION] Failed to record sent reminder for ${forkId}:`, err.message);
		}
	},

	async retrievePage(pageId) {
		return await notion.pages.retrieve({ page_id: pageId });
	},

	async limitConcurrency(fns, maxConcurrent = 3) {
		const results = [];
		const executing = new Set();
		for (let i = 0; i < fns.length; i++) {
			const fn = fns[i];
			const p = Promise.resolve().then(() => fn());
			results.push(p);
			if (maxConcurrent < fns.length) {
				executing.add(p);
				const clean = () => executing.delete(p);
				p.then(clean, clean);
				if (executing.size >= maxConcurrent) {
					await Promise.race(executing);
				}
			}
		}
		return Promise.all(results);
	},

	// ============================================
	// UTILITY
	// ============================================

	getDatabaseIds() {
		return {
			forkRegistry: databaseId,
			events: 'SQLite',
			reports: 'SQLite',
			team: 'SQLite',
			reminders: 'SQLite',
		};
	},
	client: notion,
};
