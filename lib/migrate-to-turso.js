const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@libsql/client');
const path = require('path');
require('dotenv').config();

const dbPath = path.resolve(__dirname, '../data/bot.db');
const localDb = new sqlite3.Database(dbPath);

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoToken) {
	console.error('❌ Error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env');
	process.exit(1);
}

const remoteDb = createClient({
	url: tursoUrl,
	authToken: tursoToken,
});

function localAll(sql, params = []) {
	return new Promise((resolve, reject) => {
		localDb.all(sql, params, (err, rows) => {
			if (err) reject(err);
			else resolve(rows);
		});
	});
}

const TABLES = [
	{
		name: 'meetings',
		create: `
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
		`
	},
	{
		name: 'meeting_attendees',
		create: `
			CREATE TABLE IF NOT EXISTS meeting_attendees (
				meeting_id TEXT NOT NULL,
				attendee_type TEXT NOT NULL,
				discord_id TEXT NOT NULL,
				PRIMARY KEY (meeting_id, attendee_type, discord_id)
			)
		`
	},
	{
		name: 'meeting_reminders_sent',
		create: `
			CREATE TABLE IF NOT EXISTS meeting_reminders_sent (
				meeting_id TEXT NOT NULL,
				reminder_type TEXT NOT NULL,
				sent_at INTEGER NOT NULL,
				PRIMARY KEY (meeting_id, reminder_type)
			)
		`
	},
	{
		name: 'meeting_attendance_pings',
		create: `
			CREATE TABLE IF NOT EXISTS meeting_attendance_pings (
				meeting_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				last_ping_at INTEGER NOT NULL,
				PRIMARY KEY (meeting_id, user_id)
			)
		`
	},
	{
		name: 'pending_notion_profiles',
		create: `
			CREATE TABLE IF NOT EXISTS pending_notion_profiles (
				discord_id TEXT NOT NULL,
				city TEXT NOT NULL,
				assigned_at INTEGER NOT NULL,
				last_reminded_at INTEGER NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending',
				PRIMARY KEY (discord_id, city)
			)
		`
	},
	{
		name: 'team_members',
		create: `
			CREATE TABLE IF NOT EXISTS team_members (
				id TEXT PRIMARY KEY,
				fork_id TEXT NOT NULL,
				discord_id TEXT NOT NULL,
				role TEXT NOT NULL,
				name TEXT,
				joined_date TEXT NOT NULL
			)
		`
	},
	{
		name: 'events',
		create: `
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
				created_by TEXT
			)
		`
	},
	{
		name: 'reports',
		create: `
			CREATE TABLE IF NOT EXISTS reports (
				id TEXT PRIMARY KEY,
				fork_id TEXT NOT NULL,
				type TEXT NOT NULL,
				submitted_date TEXT NOT NULL,
				attachment_url TEXT,
				notes TEXT,
				status TEXT NOT NULL
			)
		`
	}
];

async function migrate() {
	try {
		console.log('🏁 Starting migration to Turso remote database...');

		// 1. Create tables on remote DB
		for (const table of TABLES) {
			console.log(`Creating table: ${table.name} on remote...`);
			await remoteDb.execute(table.create);
		}

		// 2. Migrate data table by table
		for (const table of TABLES) {
			let rows = [];
			try {
				rows = await localAll(`SELECT * FROM ${table.name}`);
			} catch (err) {
				if (err.code === 'SQLITE_ERROR' && err.message.includes('no such table')) {
					console.log(`⚠️ Skip: local table ${table.name} does not exist in local database file.`);
					continue;
				} else {
					throw err;
				}
			}

			console.log(`📋 Found ${rows.length} rows in local table: ${table.name}`);

			if (rows.length === 0) continue;

			// Insert rows in batches or singly
			for (const row of rows) {
				const keys = Object.keys(row);
				const values = Object.values(row);
				const placeholders = keys.map(() => '?').join(', ');
				const sql = `INSERT OR REPLACE INTO ${table.name} (${keys.join(', ')}) VALUES (${placeholders})`;
				
				await remoteDb.execute({
					sql: sql,
					args: values
				});
			}
			console.log(`✅ Migrated ${rows.length} rows to remote table: ${table.name}`);
		}

		console.log('🎉 Migration completed successfully!');
		localDb.close();
		process.exit(0);
	} catch (error) {
		console.error('❌ Migration failed:', error);
		localDb.close();
		process.exit(1);
	}
}

if (require.main === module) {
	migrate();
}
