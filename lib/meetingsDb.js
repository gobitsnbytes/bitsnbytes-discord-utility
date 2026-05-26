const db = require('./db');

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
db.serialize(() => {
	db.run(`
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

	// Run migrations to add new columns (ignore errors if they already exist)
	db.run("ALTER TABLE meetings ADD COLUMN calcom_booking_id TEXT").catch(() => {});
	db.run("ALTER TABLE meetings ADD COLUMN calcom_uid TEXT").catch(() => {});
	db.run("ALTER TABLE meetings ADD COLUMN end_time INTEGER").catch(() => {});
	db.run("ALTER TABLE meetings ADD COLUMN external_emails TEXT").catch(() => {});
	db.run("ALTER TABLE user_availability ADD COLUMN calcom_event_type_id TEXT").catch(() => {});
	db.run("ALTER TABLE user_availability ADD COLUMN associated_role_id TEXT").catch(() => {});

	db.run(`
		CREATE TABLE IF NOT EXISTS meeting_attendees (
			meeting_id TEXT NOT NULL,
			attendee_type TEXT NOT NULL,
			discord_id TEXT NOT NULL,
			PRIMARY KEY (meeting_id, attendee_type, discord_id),
			FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS meeting_reminders_sent (
			meeting_id TEXT NOT NULL,
			reminder_type TEXT NOT NULL,
			sent_at INTEGER NOT NULL,
			PRIMARY KEY (meeting_id, reminder_type),
			FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS meeting_attendance_pings (
			meeting_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			last_ping_at INTEGER NOT NULL,
			PRIMARY KEY (meeting_id, user_id),
			FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS pending_notion_profiles (
			discord_id TEXT NOT NULL,
			city TEXT NOT NULL,
			assigned_at INTEGER NOT NULL,
			last_reminded_at INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			PRIMARY KEY (discord_id, city)
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS meeting_email_preferences (
			discord_id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			notify_on_invite INTEGER DEFAULT 1,
			notify_on_reminder INTEGER DEFAULT 1,
			updated_at INTEGER NOT NULL
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS web_sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			username TEXT NOT NULL,
			email TEXT,
			expires_at INTEGER NOT NULL
		)
	`);

	// Meeting transcripts storage (text only — no audio retained)
	db.run(`
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

	// Migration: add recording_status column to meetings
	db.run("ALTER TABLE meetings ADD COLUMN recording_status TEXT DEFAULT 'none'").catch(() => {});
	db.run("ALTER TABLE meetings ADD COLUMN meet_code TEXT").catch(() => {});
	db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_meet_code ON meetings(meet_code)").catch(() => {});
	db.run("ALTER TABLE meetings ADD COLUMN booked_by TEXT").catch(() => {});
	db.run("ALTER TABLE meetings ADD COLUMN scope TEXT DEFAULT 'invite'").catch(() => {});
	db.run("ALTER TABLE web_sessions ADD COLUMN avatar TEXT").catch(() => {});
	db.run("ALTER TABLE user_availability ADD COLUMN avatar TEXT").catch(() => {});

	db.run(`
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

	db.run(`
		CREATE TABLE IF NOT EXISTS push_subscriptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			endpoint TEXT NOT NULL UNIQUE,
			p256dh TEXT NOT NULL,
			auth TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)
	`);
});

function generateMeetCode() {
	const chars = 'abcdefghijklmnopqrstuvwxyz';
	const pick = () => chars[Math.floor(Math.random() * chars.length)];
	const seg = (n) => Array.from({ length: n }, pick).join('');
	return `${seg(3)}-${seg(4)}-${seg(3)}`;
}

module.exports = {
	async createMeeting(meeting) {
		const { id, title, description, scheduledTime, locationType, locationDetails, creatorId, status, calcomBookingId, calcomUid, endTime, externalEmails, bookedBy, scope } = meeting;
		const createdAt = Date.now();
		const finalStatus = status || 'scheduled';
		await dbRun(
			`INSERT INTO meetings (id, title, description, scheduled_time, location_type, location_details, status, creator_id, created_at, calcom_booking_id, calcom_uid, end_time, external_emails, booked_by, scope)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, title, description, scheduledTime, locationType, locationDetails, finalStatus, creatorId, createdAt, calcomBookingId || null, calcomUid || null, endTime || null, externalEmails ? JSON.stringify(externalEmails) : null, bookedBy || null, scope || 'invite']
		);
		const meetCode = await this.ensureMeetCode(id);
		return { id, meetCode };
	},

	async addAttendee(meetingId, type, discordId) {
		await dbRun(
			`INSERT OR IGNORE INTO meeting_attendees (meeting_id, attendee_type, discord_id)
			 VALUES (?, ?, ?)`,
			[meetingId, type, discordId]
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
		await dbRun(`UPDATE meetings SET status = ? WHERE id = ?`, [status, id]);
	},

	async setTempChannelId(id, channelId) {
		await dbRun(`UPDATE meetings SET temp_channel_id = ? WHERE id = ?`, [channelId, id]);
	},

	async findMeetingByTempChannel(channelId) {
		return await dbGet(`SELECT * FROM meetings WHERE temp_channel_id = ?`, [channelId]);
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
		const now = Date.now();
		await dbRun(
			`INSERT OR REPLACE INTO meeting_email_preferences (discord_id, email, updated_at)
			 VALUES (?, ?, ?)`,
			[discordId, email, now]
		);
	},

	async getUserEmail(discordId) {
		const row = await dbGet(
			`SELECT email FROM meeting_email_preferences WHERE discord_id = ?`,
			[discordId]
		);
		return row ? row.email : null;
	},

	async getUserEmails(discordIds) {
		if (!discordIds || discordIds.length === 0) return {};
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
		await dbRun(
			`DELETE FROM meeting_email_preferences WHERE discord_id = ?`,
			[discordId]
		);
	},

	async findUsersByEmails(emails) {
		if (!emails || emails.length === 0) return {};
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
		await dbRun(
			`UPDATE meetings SET calcom_booking_id = ? WHERE id = ?`,
			[bookingId, meetingId]
		);
	},

	// ═══════════════════════════════════════════════════
	// Transcript functions
	// ═══════════════════════════════════════════════════

	async saveTranscript(meetingId, data) {
		await dbRun(
			`INSERT OR REPLACE INTO meeting_transcripts (meeting_id, summary, key_decisions, action_items, full_transcript, timestamped_transcript, vc_text_messages, audio_duration_seconds, speaker_count, processed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[meetingId, data.summary, JSON.stringify(data.keyDecisions), JSON.stringify(data.actionItems), data.fullTranscript, data.timestampedTranscript, JSON.stringify(data.vcTextMessages || []), data.durationSeconds || 0, data.speakerCount || 0, new Date().toISOString()]
		);
	},

	async getTranscript(meetingId) {
		const row = await dbGet(`SELECT * FROM meeting_transcripts WHERE meeting_id = ?`, [meetingId]);
		if (!row) return null;
		try { row.key_decisions = JSON.parse(row.key_decisions); } catch { row.key_decisions = []; }
		try { row.action_items = JSON.parse(row.action_items); } catch { row.action_items = []; }
		try { row.vc_text_messages = JSON.parse(row.vc_text_messages); } catch { row.vc_text_messages = []; }
		return row;
	},

	async getTranscriptsForUser(discordId, { limit = 20, offset = 0, search = '' } = {}) {
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
		await dbRun(`DELETE FROM meeting_transcripts WHERE meeting_id = ?`, [meetingId]);
	},

	async updateRecordingStatus(meetingId, status) {
		await dbRun(`UPDATE meetings SET recording_status = ? WHERE id = ?`, [status, meetingId]);
	},

	async isUserAttendee(meetingId, discordId) {
		const row = await dbGet(
			`SELECT 1 FROM meeting_attendees WHERE meeting_id = ? AND discord_id = ?`,
			[meetingId, discordId]
		);
		return !!row;
	},

	async ensureMeetCode(meetingId) {
		const existing = await dbGet(`SELECT meet_code FROM meetings WHERE id = ?`, [meetingId]);
		if (existing && existing.meet_code) return existing.meet_code;

		for (let attempt = 0; attempt < 5; attempt++) {
			const code = generateMeetCode();
			try {
				await dbRun(`UPDATE meetings SET meet_code = ? WHERE id = ?`, [code, meetingId]);
				return code;
			} catch (err) {
				if (attempt === 4) throw err;
			}
		}
	},

	async getMeetingByCode(meetCode) {
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

		return await this.getMeeting(meetingId);
	},

	async getRescheduleHistory(meetingId) {
		return await dbAll(`SELECT * FROM meeting_reschedule_history WHERE meeting_id = ? ORDER BY rescheduled_at DESC`, [meetingId]);
	},

	async getRescheduleCount(meetingId) {
		const row = await dbGet(`SELECT COUNT(*) as count FROM meeting_reschedule_history WHERE meeting_id = ?`, [meetingId]);
		return row.count;
	},

	async getActiveMeetingsByCreator(creatorId) {
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

	// ═══════════════════════════════════════════════════
	// Push subscription functions
	// ═══════════════════════════════════════════════════

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
};
