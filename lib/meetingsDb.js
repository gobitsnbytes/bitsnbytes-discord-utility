const db = require('./db');
const isTest = process.env.NODE_ENV === 'test';




function dbRun(sql, params = []) {
	return db.run(sql, params);
}

function dbGet(sql, params = []) {
	return db.get(sql, params);
}

function dbAll(sql, params = []) {
	return db.all(sql, params);
}

// Initialize meetings tables
const initPromise = new Promise((resolve) => {
	if (process.env.NODE_ENV === 'test' || !db.usePostgres) {
		db.serialize(async () => {
			try {
				// 1. Create tables that don't depend on others
				await dbRun(`
					CREATE TABLE IF NOT EXISTS meetings (
						id TEXT PRIMARY KEY,
						title TEXT NOT NULL,
						description TEXT,
						scheduled_time INTEGER NOT NULL,
						location_type TEXT NOT NULL,
						location_details TEXT,
						temp_channel_id TEXT,
						status TEXT NOT NULL,
						creator_id TEXT NOT NULL,
						created_at INTEGER NOT NULL
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS user_availability (
						discord_id TEXT PRIMARY KEY,
						username TEXT NOT NULL,
						email TEXT,
						timezone TEXT DEFAULT 'Asia/Kolkata',
						weekly_hours TEXT,
						booking_link TEXT UNIQUE,
						title TEXT,
						description TEXT,
						calcom_event_type_id TEXT,
						associated_role_id TEXT,
						avatar TEXT
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS pending_notion_profiles (
						discord_id TEXT NOT NULL,
						city TEXT NOT NULL,
						assigned_at INTEGER NOT NULL,
						last_reminded_at INTEGER NOT NULL,
						status TEXT NOT NULL DEFAULT 'pending',
						PRIMARY KEY (discord_id, city)
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS meeting_email_preferences (
						discord_id TEXT PRIMARY KEY,
						email TEXT NOT NULL,
						notify_on_invite INTEGER DEFAULT 1,
						notify_on_reminder INTEGER DEFAULT 1,
						updated_at INTEGER NOT NULL
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS web_sessions (
						id TEXT PRIMARY KEY,
						user_id TEXT NOT NULL,
						username TEXT NOT NULL,
						email TEXT,
						expires_at INTEGER NOT NULL,
						avatar TEXT
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS bot_job_runs (
						job_name TEXT NOT NULL,
						period_key TEXT NOT NULL,
						ran_at INTEGER NOT NULL,
						PRIMARY KEY (job_name, period_key)
					)
				`);

				// 2. Create tables with foreign key dependencies
				await dbRun(`
					CREATE TABLE IF NOT EXISTS meeting_attendees (
						meeting_id TEXT NOT NULL,
						attendee_type TEXT NOT NULL,
						discord_id TEXT NOT NULL,
						PRIMARY KEY (meeting_id, attendee_type, discord_id),
						FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS meeting_reminders_sent (
						meeting_id TEXT NOT NULL,
						reminder_type TEXT NOT NULL,
						sent_at INTEGER NOT NULL,
						PRIMARY KEY (meeting_id, reminder_type),
						FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS meeting_attendance_pings (
						meeting_id TEXT NOT NULL,
						user_id TEXT NOT NULL,
						last_ping_at INTEGER NOT NULL,
						PRIMARY KEY (meeting_id, user_id),
						FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS meeting_transcripts (
						meeting_id TEXT PRIMARY KEY,
						summary TEXT,
						key_decisions TEXT,
						action_items TEXT,
						full_transcript TEXT,
						timestamped_transcript TEXT,
						vc_text_messages TEXT,
						audio_duration_seconds INTEGER,
						speaker_count INTEGER,
						processed_at TEXT,
						FOREIGN KEY (meeting_id) REFERENCES meetings(id)
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS meeting_reschedule_history (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						meeting_id TEXT NOT NULL,
						old_scheduled_time INTEGER NOT NULL,
						old_end_time INTEGER,
						new_scheduled_time INTEGER NOT NULL,
						new_end_time INTEGER,
						reason TEXT NOT NULL,
						rescheduled_by TEXT NOT NULL,
						rescheduled_at INTEGER NOT NULL,
						FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS push_subscriptions (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						user_id TEXT NOT NULL,
						endpoint TEXT NOT NULL UNIQUE,
						p256dh TEXT NOT NULL,
						auth TEXT NOT NULL,
						created_at INTEGER NOT NULL
					)
				`);

				await dbRun(`
					CREATE TABLE IF NOT EXISTS action_items (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						meeting_id TEXT NOT NULL,
						assignee TEXT NOT NULL,
						discord_id TEXT,
						task TEXT NOT NULL,
						deadline TEXT,
						status TEXT DEFAULT 'pending',
						notified_at INTEGER,
						created_at INTEGER NOT NULL,
						FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
					)
				`);

				await dbRun(`CREATE INDEX IF NOT EXISTS idx_action_items_discord_status ON action_items(discord_id, status)`).catch(() => {});

				// 3. Run migrations sequentially
				await dbRun("ALTER TABLE meetings ADD COLUMN calcom_booking_id TEXT").catch(() => {});
				await dbRun("ALTER TABLE meetings ADD COLUMN calcom_uid TEXT").catch(() => {});
				await dbRun("ALTER TABLE meetings ADD COLUMN end_time INTEGER").catch(() => {});
				await dbRun("ALTER TABLE meetings ADD COLUMN external_emails TEXT").catch(() => {});
				await dbRun("ALTER TABLE meetings ADD COLUMN recording_status TEXT DEFAULT 'none'").catch(() => {});
				await dbRun("ALTER TABLE meetings ADD COLUMN meet_code TEXT").catch(() => {});
				await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_meet_code ON meetings(meet_code)").catch(() => {});
				await dbRun("ALTER TABLE meetings ADD COLUMN booked_by TEXT").catch(() => {});
				await dbRun("ALTER TABLE meetings ADD COLUMN scope TEXT DEFAULT 'invite'").catch(() => {});
				await dbRun("ALTER TABLE meetings ADD COLUMN activated_at INTEGER").catch(() => {});
				await dbRun("ALTER TABLE user_availability ADD COLUMN calcom_event_type_id TEXT").catch(() => {});
				await dbRun("ALTER TABLE user_availability ADD COLUMN associated_role_id TEXT").catch(() => {});
				await dbRun("ALTER TABLE user_availability ADD COLUMN avatar TEXT").catch(() => {});
				await dbRun("ALTER TABLE web_sessions ADD COLUMN avatar TEXT").catch(() => {});
			} catch (err) {
				console.error("[MEETINGS_DB] SQLite schema initialization error:", err);
			} finally {
				if (!isTest) {
					syncLocalMirrorWithMotherboard().catch(err => {
						console.error('[MEETINGS_DB] Initial sync failed:', err.message);
					});
				}
				resolve();
			}
		});
	} else {
		// Production/Staging: Just verify database connection
		dbRun('SELECT 1 as connection_test')
			.then(() => {
				console.log('[MEETINGS_DB] Neon Postgres connection verified successfully.');
				resolve();
			})
			.catch((err) => {
				console.error('[MEETINGS_DB] Failed to verify Neon Postgres connection:', err.message);
				resolve();
			});
	}
});

async function syncLocalMirrorWithMotherboard() {
	try {
		console.log('[MEETINGS_DB] Syncing local SQLite mirror with Motherboard API...');
		const { callMotherboard } = require('./motherboardApi');
		const list = await callMotherboard('GET', '/api/meetings', 'discord_bot');
		if (Array.isArray(list)) {
			await db.transaction(async (tx) => {
				for (const m of list) {
					// Insert/Replace meeting
					await tx.execute({
						sql: `INSERT OR REPLACE INTO meetings (id, title, description, scheduled_time, location_type, location_details, temp_channel_id, status, creator_id, created_at, calcom_booking_id, calcom_uid, end_time, external_emails, booked_by, scope, meet_code, activated_at, recording_status)
						      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						args: [
							m.id,
							m.title,
							m.description || '',
							m.scheduled_time,
							m.location_type,
							m.location_details || '',
							m.temp_channel_id || null,
							m.status,
							m.creator_id,
							m.created_at || Date.now(),
							m.calcom_booking_id || null,
							m.calcom_uid || null,
							m.end_time || null,
							m.external_emails ? JSON.stringify(m.external_emails.split(',')) : null,
							m.booked_by || null,
							m.scope || 'invite',
							m.meet_code || null,
							m.activated_at || null,
							m.recording_status || 'none'
						]
					});
					
					// Insert/Replace attendees
					if (m.attendees && Array.isArray(m.attendees)) {
						for (const a of m.attendees) {
							await tx.execute({
								sql: `INSERT OR IGNORE INTO meeting_attendees (meeting_id, attendee_type, discord_id) VALUES (?, ?, ?)`,
								args: [m.id, a.attendee_type, a.discord_id]
							});
						}
					}
				}
			});
			console.log(`[MEETINGS_DB] Local mirror sync complete. Synced ${list.length} meetings.`);
		}
	} catch (err) {
		console.warn('[MEETINGS_DB] Warning: Local mirror sync failed (Motherboard API may be unreachable/offline):', err.message);
	}
}

function generateMeetCode() {
	const chars = 'abcdefghijklmnopqrstuvwxyz';
	const pick = () => chars[Math.floor(Math.random() * chars.length)];
	const seg = (n) => Array.from({ length: n }, pick).join('');
	return `${seg(3)}-${seg(4)}-${seg(3)}`;
}

module.exports = {
	initPromise,
	async createMeeting(meeting) {
		if (!isTest) {
			const { callMotherboard } = require('./motherboardApi');
			const response = await callMotherboard('POST', '/api/meetings/schedule', 'discord_bot', {
				title: meeting.title,
				description: meeting.description || '',
				scheduled_time: meeting.scheduledTime,
				duration_minutes: meeting.endTime ? Math.round((meeting.endTime - meeting.scheduledTime) / 60000) : 30,
				location_type: meeting.locationType,
				location_details: meeting.locationDetails || '',
				creator_id: meeting.creatorId,
				invitees: [],
				external_emails: meeting.externalEmails || [],
				notes: '',
				scope: meeting.scope || 'invite',
				calcom_booking_id: meeting.calcomBookingId || null,
				calcom_uid: meeting.calcomUid || null
			});

			try {
				await db.transaction(async (tx) => {
					await tx.execute({
						sql: `INSERT OR REPLACE INTO meetings (id, title, description, scheduled_time, location_type, location_details, status, creator_id, created_at, calcom_booking_id, calcom_uid, end_time, external_emails, booked_by, scope, meet_code)
						      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						args: [
							response.id,
							meeting.title,
							meeting.description || '',
							meeting.scheduledTime,
							meeting.locationType,
							meeting.locationDetails || '',
							meeting.status || 'scheduled',
							meeting.creatorId,
							meeting.createdAt || Date.now(),
							meeting.calcomBookingId || null,
							meeting.calcomUid || null,
							meeting.endTime || null,
							meeting.externalEmails ? JSON.stringify(meeting.externalEmails) : null,
							meeting.bookedBy || null,
							meeting.scope || 'invite',
							response.meet_code
						]
					});
				});
			} catch (sqliteErr) {
				console.error('[meetingsDb] Failed to write local mirror for createMeeting:', sqliteErr.message);
			}

			return { id: response.id, meetCode: response.meet_code };
		}
		const { id, title, description, scheduledTime, locationType, locationDetails, creatorId, status, calcomBookingId, calcomUid, endTime, externalEmails, bookedBy, scope } = meeting;
		const createdAt = meeting.createdAt || Date.now();
		const finalStatus = status || 'scheduled';
		
		return await db.transaction(async (tx) => {
			await tx.execute({
				sql: `INSERT INTO meetings (id, title, description, scheduled_time, location_type, location_details, status, creator_id, created_at, calcom_booking_id, calcom_uid, end_time, external_emails, booked_by, scope)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [id, title, description, scheduledTime, locationType, locationDetails, finalStatus, creatorId, createdAt || Date.now(), calcomBookingId || null, calcomUid || null, endTime || null, externalEmails ? JSON.stringify(externalEmails) : null, bookedBy || null, scope || 'invite']
			});
			const meetCode = generateMeetCode();
			await tx.execute({
				sql: `UPDATE meetings SET meet_code = ? WHERE id = ?`,
				args: [meetCode, id]
			});
			return { id, meetCode };
		});
	},

	async addAttendee(meetingId, type, discordId) {
		if (!isTest) return;
		await dbRun(
			`INSERT OR IGNORE INTO meeting_attendees (meeting_id, attendee_type, discord_id)
			 VALUES (?, ?, ?)`,
			[meetingId, type, discordId]
		);
	},

	async removeAttendee(meetingId, discordId) {
		if (!isTest) return;
		await dbRun(
			`DELETE FROM meeting_attendees WHERE meeting_id = ? AND discord_id = ?`,
			[meetingId, discordId]
		);
	},

	async getMeeting(id) {
		const meeting = await dbGet(`SELECT * FROM meetings WHERE id = ?`, [id]);
		if (!meeting) return null;
		
		const attendees = await dbAll(`SELECT * FROM meeting_attendees WHERE meeting_id = ?`, [id]);
		meeting.attendees = attendees.map(a => ({
			type: a.attendee_type,
			discordId: a.discord_id
		}));

		if (meeting.external_emails) {
			try {
				meeting.externalEmails = JSON.parse(meeting.external_emails);
			} catch (e) {
				meeting.externalEmails = [];
			}
		} else {
			meeting.externalEmails = [];
		}
		return meeting;
	},

	async getUpcomingMeetings() {
		const meetings = await dbAll(`SELECT * FROM meetings WHERE status = ? ORDER BY scheduled_time ASC`, ['scheduled']);
		for (const meeting of meetings) {
			const attendees = await dbAll(`SELECT * FROM meeting_attendees WHERE meeting_id = ?`, [meeting.id]);
			meeting.attendees = attendees.map(a => ({
				type: a.attendee_type,
				discordId: a.discord_id
			}));

			if (meeting.external_emails) {
				try {
					meeting.externalEmails = JSON.parse(meeting.external_emails);
				} catch (e) {
					meeting.externalEmails = [];
				}
			} else {
				meeting.externalEmails = [];
			}
		}
		return meetings;
	},

	async getActiveMeetings() {
		const meetings = await dbAll(`SELECT * FROM meetings WHERE status = ? ORDER BY scheduled_time ASC`, ['active']);
		for (const meeting of meetings) {
			const attendees = await dbAll(`SELECT * FROM meeting_attendees WHERE meeting_id = ?`, [meeting.id]);
			meeting.attendees = attendees.map(a => ({
				type: a.attendee_type,
				discordId: a.discord_id
			}));

			if (meeting.external_emails) {
				try {
					meeting.externalEmails = JSON.parse(meeting.external_emails);
				} catch (e) {
					meeting.externalEmails = [];
				}
			} else {
				meeting.externalEmails = [];
			}
		}
		return meetings;
	},

	async updateMeetingStatus(id, status) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				if (status === 'active') {
					await callMotherboard('POST', `/api/meetings/${id}/start`, 'discord_bot');
				} else if (status === 'completed') {
					await callMotherboard('POST', `/api/meetings/${id}/stop`, 'discord_bot');
				} else {
					await callMotherboard('PATCH', `/api/meetings/${id}`, 'discord_bot', { status });
				}
			} catch (e) {
				console.error('[meetingsDb] updateMeetingStatus error:', e.message);
			}
		}
		if (status === 'active') {
			await dbRun(`UPDATE meetings SET status = ?, activated_at = ? WHERE id = ?`, [status, Date.now(), id]);
		} else {
			await dbRun(`UPDATE meetings SET status = ? WHERE id = ?`, [status, id]);
		}
	},

	async setTempChannelId(id, channelId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				await callMotherboard('PATCH', `/api/meetings/${id}`, 'discord_bot', { temp_channel_id: channelId });
			} catch (e) {
				console.error('[meetingsDb] setTempChannelId error:', e.message);
			}
		}
		await dbRun(`UPDATE meetings SET temp_channel_id = ? WHERE id = ?`, [channelId, id]);
	},

	async findMeetingByTempChannel(channelId) {
		const meeting = await dbGet(`SELECT * FROM meetings WHERE temp_channel_id = ?`, [channelId]);
		if (!meeting) return null;
		
		const attendees = await dbAll(`SELECT * FROM meeting_attendees WHERE meeting_id = ?`, [meeting.id]);
		meeting.attendees = attendees.map(a => ({
			type: a.attendee_type,
			discordId: a.discord_id
		}));

		if (meeting.external_emails) {
			try {
				meeting.externalEmails = JSON.parse(meeting.external_emails);
			} catch (e) {
				meeting.externalEmails = [];
			}
		} else {
			meeting.externalEmails = [];
		}
		return meeting;
	},

	async hasReminderBeenSent(meetingId, type) {
		const row = await dbGet(
			`SELECT 1 FROM meeting_reminders_sent WHERE meeting_id = ? AND reminder_type = ?`,
			[meetingId, type]
		);
		return !!row;
	},

	async recordReminderSent(meetingId, type) {
		await dbRun(
			`INSERT OR REPLACE INTO meeting_reminders_sent (meeting_id, reminder_type, sent_at)
			 VALUES (?, ?, ?)`,
			[meetingId, type, Date.now()]
		);
	},

	async getLastPingTime(meetingId, userId) {
		const row = await dbGet(
			`SELECT last_ping_at FROM meeting_attendance_pings WHERE meeting_id = ? AND user_id = ?`,
			[meetingId, userId]
		);
		return row ? row.last_ping_at : 0;
	},

	async updateLastPingTime(meetingId, userId) {
		await dbRun(
			`INSERT OR REPLACE INTO meeting_attendance_pings (meeting_id, user_id, last_ping_at)
			 VALUES (?, ?, ?)`,
			[meetingId, userId, Date.now()]
		);
	},

	async addPendingProfile(discordId, city) {
		const now = Date.now();
		await dbRun(
			`INSERT OR REPLACE INTO pending_notion_profiles (discord_id, city, assigned_at, last_reminded_at, status)
			 VALUES (?, ?, ?, ?, 'pending')`,
			[discordId, city, now, now]
		);
	},

	async getPendingProfiles() {
		return await dbAll(`SELECT * FROM pending_notion_profiles WHERE status = 'pending'`);
	},

	async resolvePendingProfile(discordId, city) {
		await dbRun(
			`UPDATE pending_notion_profiles SET status = 'resolved' WHERE discord_id = ? AND city = ?`,
			[discordId, city]
		);
	},

	async updateProfileReminderTime(discordId, city) {
		await dbRun(
			`UPDATE pending_notion_profiles SET last_reminded_at = ? WHERE discord_id = ? AND city = ?`,
			[Date.now(), discordId, city]
		);
	},

	async setUserEmail(discordId, email) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				await callMotherboard('POST', '/api/meetings/preferences', 'discord_bot', {
					discord_id: discordId,
					email: email,
					notify_on_invite: 1,
					notify_on_reminder: 1,
					updated_at: Date.now()
				});
			} catch (e) {
				console.error('[meetingsDb] setUserEmail error:', e.message);
			}
			return;
		}
		const now = Date.now();
		await dbRun(
			`INSERT OR REPLACE INTO meeting_email_preferences (discord_id, email, updated_at)
			 VALUES (?, ?, ?)`,
			[discordId, email, now]
		);
	},

	async getUserEmail(discordId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const pref = await callMotherboard('GET', `/api/meetings/preferences/${discordId}`, 'discord_bot');
				return pref ? pref.email : null;
			} catch (e) {
				return null;
			}
		}
		const row = await dbGet(
			`SELECT email FROM meeting_email_preferences WHERE discord_id = ?`,
			[discordId]
		);
		return row ? row.email : null;
	},

	async getUserEmails(discordIds) {
		if (!discordIds || discordIds.length === 0) return {};
		if (!isTest) {
			const { callMotherboard } = require('./motherboardApi');
			const map = {};
			await Promise.all(discordIds.map(async (id) => {
				try {
					const pref = await callMotherboard('GET', `/api/meetings/preferences/${id}`, 'discord_bot');
					if (pref && pref.email) {
						map[id] = pref.email;
					}
				} catch (e) {
					// fallback/no preference set
				}
			}));
			return map;
		}
		const placeholders = discordIds.map(() => '?').join(',');
		const rows = await dbAll(
			`SELECT discord_id, email FROM meeting_email_preferences WHERE discord_id IN (${placeholders})`,
			discordIds
		);
		const map = {};
		for (const r of rows) {
			map[r.discord_id] = r.email;
		}
		return map;
	},

	async removeUserEmail(discordId) {
		if (!isTest) return;
		await dbRun(
			`DELETE FROM meeting_email_preferences WHERE discord_id = ?`,
			[discordId]
		);
	},

	async findUsersByEmails(emails) {
		if (!emails || emails.length === 0) return {};
		if (!isTest) {
			// fallback/unused in bot production code
			return {};
		}
		const lowercaseEmails = emails.map(e => e.toLowerCase());
		const placeholders = lowercaseEmails.map(() => '?').join(',');
		const rows = await dbAll(
			`SELECT discord_id, email FROM meeting_email_preferences WHERE LOWER(email) IN (${placeholders})`,
			lowercaseEmails
		);
		const map = {};
		for (const r of rows) {
			map[r.email.toLowerCase()] = r.discord_id;
		}
		return map;
	},

	async findMeetingByCalcomId(bookingId) {
		const meeting = await dbGet(
			`SELECT * FROM meetings WHERE calcom_booking_id = ? OR calcom_uid = ?`,
			[bookingId, bookingId]
		);
		if (!meeting) return null;
		const attendees = await dbAll(`SELECT * FROM meeting_attendees WHERE meeting_id = ?`, [meeting.id]);
		meeting.attendees = attendees.map(a => ({
			type: a.attendee_type,
			discordId: a.discord_id
		}));

		if (meeting.external_emails) {
			try {
				meeting.externalEmails = JSON.parse(meeting.external_emails);
			} catch (e) {
				meeting.externalEmails = [];
			}
		} else {
			meeting.externalEmails = [];
		}
		return meeting;
	},

	async setCalcomBookingId(meetingId, bookingId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				await callMotherboard('PATCH', `/api/meetings/${meetingId}`, 'discord_bot', { calcom_booking_id: bookingId });
			} catch (e) {
				console.error('[meetingsDb] setCalcomBookingId error:', e.message);
			}
		}
		await dbRun(
			`UPDATE meetings SET calcom_booking_id = ? WHERE id = ?`,
			[bookingId, meetingId]
		);
	},

	// ═══════════════════════════════════════════════════
	// Transcript functions
	// ═══════════════════════════════════════════════════

	async saveTranscript(meetingId, data) {
		if (!isTest) return;
		await dbRun(
			`INSERT OR REPLACE INTO meeting_transcripts (meeting_id, summary, key_decisions, action_items, full_transcript, timestamped_transcript, vc_text_messages, audio_duration_seconds, speaker_count, processed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[meetingId, data.summary, JSON.stringify(data.keyDecisions), JSON.stringify(data.actionItems), data.fullTranscript, data.timestampedTranscript, JSON.stringify(data.vcTextMessages || []), data.durationSeconds || 0, data.speakerCount || 0, new Date().toISOString()]
		);
	},

	async getTranscript(meetingId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const m = await callMotherboard('GET', `/api/meetings/${meetingId}`, 'discord_bot');
				if (!m || !m.transcript) return null;
				const mt = m.transcript;
				return {
					meeting_id: mt.meeting_id,
					summary: mt.summary,
					key_decisions: mt.key_decisions ? JSON.parse(mt.key_decisions) : [],
					action_items: mt.action_items ? JSON.parse(mt.action_items) : [],
					vc_text_messages: mt.vc_text_messages ? JSON.parse(mt.vc_text_messages) : [],
					audio_duration_seconds: mt.audio_duration_seconds,
					speaker_count: mt.speaker_count,
					processed_at: mt.processed_at,
					full_transcript: mt.full_transcript,
					timestamped_transcript: mt.timestamped_transcript
				};
			} catch (e) {
				console.error('[meetingsDb] getTranscript error:', e.message);
				return null;
			}
		}
		const row = await dbGet(`SELECT * FROM meeting_transcripts WHERE meeting_id = ?`, [meetingId]);
		if (!row) return null;
		try { row.key_decisions = JSON.parse(row.key_decisions); } catch { row.key_decisions = []; }
		try { row.action_items = JSON.parse(row.action_items); } catch { row.action_items = []; }
		try { row.vc_text_messages = JSON.parse(row.vc_text_messages); } catch { row.vc_text_messages = []; }
		return row;
	},

	async getTranscriptsForUser(discordId, { limit = 20, offset = 0, search = '' } = {}) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const list = await callMotherboard('GET', '/api/meetings', 'discord_bot');
				let filtered = list.filter(m => m.transcript && (m.creator_id === discordId || (m.attendees || []).some(a => a.discord_id === discordId)));
				if (search) {
					filtered = filtered.filter(m => m.title.toLowerCase().includes(search.toLowerCase()));
				}
				filtered = filtered.slice(offset, offset + limit);
				return filtered.map(m => ({
					id: m.id,
					title: m.title,
					scheduled_time: m.scheduled_time,
					status: m.status,
					creator_id: m.creator_id,
					processed_at: m.transcript.processed_at,
					audio_duration_seconds: m.transcript.audio_duration_seconds,
					speaker_count: m.transcript.speaker_count
				}));
			} catch (e) {
				console.error('[meetingsDb] getTranscriptsForUser error:', e.message);
				return [];
			}
		}
		let sql = `
			SELECT DISTINCT m.id, m.title, m.scheduled_time, m.status, m.creator_id, mt.processed_at, mt.audio_duration_seconds, mt.speaker_count
			FROM meetings m
			INNER JOIN meeting_transcripts mt ON m.id = mt.meeting_id
			LEFT JOIN meeting_attendees ma ON m.id = ma.meeting_id
			WHERE (ma.discord_id = ? OR m.creator_id = ?)
		`;
		const params = [discordId, discordId];
		if (search) {
			sql += ` AND m.title LIKE ?`;
			params.push(`%${search}%`);
		}
		sql += ` ORDER BY m.scheduled_time DESC LIMIT ? OFFSET ?`;
		params.push(limit, offset);
		return await dbAll(sql, params);
	},

	async getAllTranscripts({ limit = 20, offset = 0, search = '' } = {}) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const list = await callMotherboard('GET', '/api/meetings', 'discord_bot');
				let filtered = list.filter(m => m.transcript);
				if (search) {
					filtered = filtered.filter(m => m.title.toLowerCase().includes(search.toLowerCase()));
				}
				filtered = filtered.slice(offset, offset + limit);
				return filtered.map(m => ({
					id: m.id,
					title: m.title,
					scheduled_time: m.scheduled_time,
					status: m.status,
					creator_id: m.creator_id,
					processed_at: m.transcript.processed_at,
					audio_duration_seconds: m.transcript.audio_duration_seconds,
					speaker_count: m.transcript.speaker_count
				}));
			} catch (e) {
				console.error('[meetingsDb] getAllTranscripts error:', e.message);
				return [];
			}
		}
		let sql = `
			SELECT m.id, m.title, m.scheduled_time, m.status, m.creator_id, mt.processed_at, mt.audio_duration_seconds, mt.speaker_count
			FROM meetings m
			INNER JOIN meeting_transcripts mt ON m.id = mt.meeting_id
		`;
		const params = [];
		if (search) {
			sql += ` WHERE m.title LIKE ?`;
			params.push(`%${search}%`);
		}
		sql += ` ORDER BY m.scheduled_time DESC LIMIT ? OFFSET ?`;
		params.push(limit, offset);
		return await dbAll(sql, params);
	},

	async deleteTranscript(meetingId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				await callMotherboard('DELETE', `/api/meetings/${meetingId}`, 'discord_bot');
			} catch (e) {
				console.error('[meetingsDb] deleteTranscript error:', e.message);
			}
			return;
		}
		await dbRun(`DELETE FROM meeting_transcripts WHERE meeting_id = ?`, [meetingId]);
	},

	async updateRecordingStatus(meetingId, status) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				await callMotherboard('PATCH', `/api/meetings/${meetingId}`, 'discord_bot', { recording_status: status });
			} catch (e) {
				console.error('[meetingsDb] updateRecordingStatus error:', e.message);
			}
		}
		await dbRun(`UPDATE meetings SET recording_status = ? WHERE id = ?`, [status, meetingId]);
	},

	async isUserAttendee(meetingId, discordId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const m = await callMotherboard('GET', `/api/meetings/${meetingId}`, 'discord_bot');
				if (!m) return false;
				if (m.creator_id === discordId) return true;
				return (m.attendees || []).some(a => a.discord_id === discordId);
			} catch (e) {
				return false;
			}
		}
		const row = await dbGet(
			`SELECT 1 FROM meeting_attendees WHERE meeting_id = ? AND discord_id = ?`,
			[meetingId, discordId]
		);
		return !!row;
	},

	async ensureMeetCode(meetingId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const m = await callMotherboard('GET', `/api/meetings/${meetingId}`, 'discord_bot');
				return m ? m.meet_code : null;
			} catch (e) {
				return null;
			}
		}
		const existing = await dbGet(`SELECT meet_code FROM meetings WHERE id = ?`, [meetingId]);
		if (existing && existing.meet_code) return existing.meet_code;

		for (let attempt = 0; attempt < 10; attempt++) {
			const code = generateMeetCode();
			try {
				const result = await dbRun(
					`UPDATE meetings SET meet_code = ? WHERE id = ? AND meet_code IS NULL`,
					[code, meetingId]
				);
				const changes = result?.changes ?? result?.rowsAffected ?? 0;
				if (changes > 0) {
					return code;
				}
				const doubleCheck = await dbGet(`SELECT meet_code FROM meetings WHERE id = ?`, [meetingId]);
				if (doubleCheck && doubleCheck.meet_code) return doubleCheck.meet_code;
			} catch (err) {
				if (attempt === 9) throw err;
			}
		}
	},

	async tryClaimReminder(meetingId, reminderType) {
		try {
			const result = await dbRun(
				`INSERT OR IGNORE INTO meeting_reminders_sent (meeting_id, reminder_type, sent_at)
				 VALUES (?, ?, ?)`,
				[meetingId, reminderType, Date.now()]
			);
			const changes = result?.changes ?? result?.rowsAffected ?? 0;
			return changes > 0;
		} catch (err) {
			return false;
		}
	},

	async tryClaimJobRun(jobName, periodKey) {
		try {
			const result = await dbRun(
				`INSERT OR IGNORE INTO bot_job_runs (job_name, period_key, ran_at)
				 VALUES (?, ?, ?)`,
				[jobName, periodKey, Date.now()]
			);
			const changes = result?.changes ?? result?.rowsAffected ?? 0;
			return changes > 0;
		} catch (err) {
			return false;
		}
	},

	async getMeetingByCode(meetCode) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const list = await callMotherboard('GET', '/api/meetings', 'discord_bot');
				const matched = list.find(m => m.meet_code === meetCode);
				if (!matched) return null;
				return {
					...matched,
					scheduled_time: matched.scheduled_time,
					attendees: (matched.attendees || []).map(a => ({
						type: a.attendee_type,
						discordId: a.discord_id
					})),
					externalEmails: matched.external_emails ? matched.external_emails.split(',') : []
				};
			} catch (e) {
				console.error('[meetingsDb] getMeetingByCode error:', e.message);
				return null;
			}
		}
		const meeting = await dbGet(`SELECT * FROM meetings WHERE meet_code = ?`, [meetCode]);
		if (!meeting) return null;

		const attendees = await dbAll(`SELECT * FROM meeting_attendees WHERE meeting_id = ?`, [meeting.id]);
		meeting.attendees = attendees.map(a => ({
			type: a.attendee_type,
			discordId: a.discord_id
		}));

		if (meeting.external_emails) {
			try {
				meeting.externalEmails = JSON.parse(meeting.external_emails);
			} catch (e) {
				meeting.externalEmails = [];
			}
		} else {
			meeting.externalEmails = [];
		}
		return meeting;
	},

	async rescheduleMeeting(meetingId, newScheduledTime, newEndTime, reason, rescheduledBy) {
		let response = null;
		if (!isTest) {
			const { callMotherboard } = require('./motherboardApi');
			response = await callMotherboard('PATCH', `/api/meetings/${meetingId}`, rescheduledBy, {
				scheduled_time: newScheduledTime,
				end_time: newEndTime,
				reschedule_reason: reason,
				rescheduled_by: rescheduledBy
			});
		}

		const meeting = await dbGet(`SELECT * FROM meetings WHERE id = ?`, [meetingId]);
		if (!meeting) throw new Error('Meeting not found');

		const countRow = await dbGet(`SELECT COUNT(*) as count FROM meeting_reschedule_history WHERE meeting_id = ?`, [meetingId]);
		if (countRow.count >= 3) throw new Error('Reschedule limit (3) reached for this meeting');

		await dbRun(
			`INSERT INTO meeting_reschedule_history (meeting_id, old_scheduled_time, old_end_time, new_scheduled_time, new_end_time, reason, rescheduled_by, rescheduled_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[meetingId, meeting.scheduled_time, meeting.end_time || null, newScheduledTime, newEndTime || null, reason, rescheduledBy, Date.now()]
		);

		await dbRun(`UPDATE meetings SET scheduled_time = ?, end_time = ? WHERE id = ?`, [newScheduledTime, newEndTime || null, meetingId]);

		if (!isTest && response) {
			return {
				...response,
				scheduled_time: response.scheduled_time,
				attendees: (response.attendees || []).map(a => ({
					type: a.attendee_type,
					discordId: a.discord_id
				})),
				externalEmails: response.external_emails ? response.external_emails.split(',') : []
			};
		}
		return await this.getMeeting(meetingId);
	},

	async getRescheduleHistory(meetingId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const m = await callMotherboard('GET', `/api/meetings/${meetingId}`, 'discord_bot');
				return m ? (m.reschedule_history || []) : [];
			} catch (e) {
				return [];
			}
		}
		return await dbAll(`SELECT * FROM meeting_reschedule_history WHERE meeting_id = ? ORDER BY rescheduled_at DESC`, [meetingId]);
	},

	async getRescheduleCount(meetingId) {
		if (!isTest) {
			const hist = await this.getRescheduleHistory(meetingId);
			return hist.length;
		}
		const row = await dbGet(`SELECT COUNT(*) as count FROM meeting_reschedule_history WHERE meeting_id = ?`, [meetingId]);
		return row.count;
	},

	async getActiveMeetingsForUser(userId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const list = await callMotherboard('GET', '/api/meetings', 'discord_bot');
				const filtered = list.filter(m => ['scheduled', 'active', 'pending'].includes(m.status) && (m.creator_id === userId || (m.attendees || []).some(a => a.discord_id === userId)));
				return filtered.map(m => ({
					...m,
					scheduled_time: m.scheduled_time,
					attendees: (m.attendees || []).map(a => ({
						type: a.attendee_type,
						discordId: a.discord_id
					})),
					externalEmails: m.external_emails ? m.external_emails.split(',') : []
				}));
			} catch (e) {
				console.error('[meetingsDb] getActiveMeetingsForUser error:', e.message);
				return [];
			}
		}
		const meetings = await dbAll(
			`SELECT DISTINCT m.* FROM meetings m
			 LEFT JOIN meeting_attendees ma ON m.id = ma.meeting_id
			 WHERE (m.creator_id = ? OR (ma.discord_id = ? AND ma.attendee_type = 'user'))
			   AND m.status IN ('scheduled', 'active', 'pending')
			 ORDER BY m.scheduled_time ASC`,
			[userId, userId]
		);
		for (const meeting of meetings) {
			const attendees = await dbAll(`SELECT * FROM meeting_attendees WHERE meeting_id = ?`, [meeting.id]);
			meeting.attendees = attendees.map(a => ({
				type: a.attendee_type,
				discordId: a.discord_id
			}));

			if (meeting.external_emails) {
				try {
					meeting.externalEmails = JSON.parse(meeting.external_emails);
				} catch (e) {
					meeting.externalEmails = [];
				}
			} else {
				meeting.externalEmails = [];
			}
		}
		return meetings;
	},

	async getActiveMeetingsByCreator(creatorId) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const list = await callMotherboard('GET', `/api/meetings?creator_id=${creatorId}`, 'discord_bot');
				const filtered = list.filter(m => ['scheduled', 'active', 'pending'].includes(m.status));
				return filtered.map(m => ({
					...m,
					scheduled_time: m.scheduled_time,
					attendees: (m.attendees || []).map(a => ({
						type: a.attendee_type,
						discordId: a.discord_id
					})),
					externalEmails: m.external_emails ? m.external_emails.split(',') : []
				}));
			} catch (e) {
				console.error('[meetingsDb] getActiveMeetingsByCreator error:', e.message);
				return [];
			}
		}
		const meetings = await dbAll(`SELECT * FROM meetings WHERE creator_id = ? AND status IN ('scheduled', 'active', 'pending') ORDER BY scheduled_time ASC`, [creatorId]);
		for (const meeting of meetings) {
			const attendees = await dbAll(`SELECT * FROM meeting_attendees WHERE meeting_id = ?`, [meeting.id]);
			meeting.attendees = attendees.map(a => ({
				type: a.attendee_type,
				discordId: a.discord_id
			}));

			if (meeting.external_emails) {
				try {
					meeting.externalEmails = JSON.parse(meeting.external_emails);
				} catch (e) {
					meeting.externalEmails = [];
				}
			} else {
				meeting.externalEmails = [];
			}
		}
		return meetings;
	},

	async savePushSubscription(userId, subscription) {
		const { endpoint, keys } = subscription;
		await dbRun(
			`INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
			 VALUES (?, ?, ?, ?, ?)`,
			[userId, endpoint, keys.p256dh, keys.auth, Date.now()]
		);
	},

	async getPushSubscriptions(userId) {
		return await dbAll(`SELECT * FROM push_subscriptions WHERE user_id = ?`, [userId]);
	},

	async getPushSubscriptionsForUsers(userIds) {
		if (!userIds || userIds.length === 0) return [];
		const placeholders = userIds.map(() => '?').join(',');
		return await dbAll(
			`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`,
			userIds
		);
	},

	async removePushSubscription(endpoint) {
		await dbRun(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [endpoint]);
	},

	async createActionItem(meetingId, assignee, discordId, task, deadline) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const ai = await callMotherboard('POST', `/api/meetings/${meetingId}/action-items`, 'discord_bot', {
					assignee,
					discord_id: discordId || null,
					task,
					deadline: deadline || null
				});
				return ai.id;
			} catch (e) {
				console.error('[meetingsDb] createActionItem error:', e.message);
				return Date.now();
			}
		}
		const result = await dbRun(
			`INSERT INTO action_items (meeting_id, assignee, discord_id, task, deadline, status, created_at)
			 VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
			[meetingId, assignee, discordId || null, task, deadline || null, Date.now()]
		);
		return result?.lastID || result?.insertId;
	},

	async getActionItemsForUser(discordId, status) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				const list = await callMotherboard('GET', '/api/meetings', 'discord_bot');
				let allActionItems = [];
				for (const m of list) {
					if (m.transcript && m.transcript.action_items) {
						let items = [];
						try { items = JSON.parse(m.transcript.action_items); } catch {}
						allActionItems.push(...items.map(it => ({ ...it, meeting_id: m.id, title: m.title })));
					}
				}
				let filtered = allActionItems.filter(ai => ai.discord_id === discordId);
				if (status) {
					filtered = filtered.filter(ai => ai.status === status);
				}
				return filtered;
			} catch (e) {
				console.error('[meetingsDb] getActionItemsForUser error:', e.message);
				return [];
			}
		}
		if (status) {
			return await dbAll(`SELECT * FROM action_items WHERE discord_id = ? AND status = ? ORDER BY created_at DESC`, [discordId, status]);
		}
		return await dbAll(`SELECT * FROM action_items WHERE discord_id = ? ORDER BY created_at DESC`, [discordId]);
	},

	async updateActionItemStatus(id, status) {
		if (!isTest) {
			try {
				const { callMotherboard } = require('./motherboardApi');
				await callMotherboard('PATCH', `/api/meetings/action-items/${id}/status`, 'discord_bot', { status });
			} catch (e) {
				console.error('[meetingsDb] updateActionItemStatus error:', e.message);
			}
			return;
		}
		await dbRun(`UPDATE action_items SET status = ? WHERE id = ?`, [status, id]);
	},

	async getActionItem(id) {
		if (!isTest) {
			return null;
		}
		return await dbGet(`SELECT * FROM action_items WHERE id = ?`, [id]);
	},
};
