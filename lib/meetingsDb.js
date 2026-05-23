const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../data/bot.db');
const db = new sqlite3.Database(dbPath);

function dbRun(sql, params = []) {
	return new Promise((resolve, reject) => {
		db.run(sql, params, function (err) {
			if (err) reject(err);
			else resolve(this);
		});
	});
}

function dbGet(sql, params = []) {
	return new Promise((resolve, reject) => {
		db.get(sql, params, (err, row) => {
			if (err) reject(err);
			else resolve(row);
		});
	});
}

function dbAll(sql, params = []) {
	return new Promise((resolve, reject) => {
		db.all(sql, params, (err, rows) => {
			if (err) reject(err);
			else resolve(rows);
		});
	});
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
});

module.exports = {
	async createMeeting(meeting) {
		const { id, title, description, scheduledTime, locationType, locationDetails, creatorId, status } = meeting;
		const createdAt = Date.now();
		const finalStatus = status || 'scheduled';
		await dbRun(
			`INSERT INTO meetings (id, title, description, scheduled_time, location_type, location_details, status, creator_id, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, title, description, scheduledTime, locationType, locationDetails, finalStatus, creatorId, createdAt]
		);
		return id;
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
	}
};
