const path = require('path');
const fs = require('fs');

require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test' || 
               !!process.env.BUN_TEST ||
               !!process.env.JEST_WORKER_ID || 
               typeof globalThis.describe !== 'undefined' || 
               typeof globalThis.test !== 'undefined';

// Support both DATABASE_BOUNCER_URL and DATABASE_URL
let pgUrl = process.env.DATABASE_BOUNCER_URL || process.env.DATABASE_URL;

// If asyncpg driver prefix is present, rewrite for pg compatibility
if (pgUrl && pgUrl.startsWith('postgresql+asyncpg://')) {
	pgUrl = pgUrl.replace('postgresql+asyncpg://', 'postgresql://');
}

const usePostgres = false;

let pool = null;
let localDb = null;
let dbPath = null;

if (usePostgres) {
	console.log('[DB] Connecting to remote PostgreSQL database...');
	const { Pool } = require('pg');
	
	let cleanPgUrl = pgUrl;
	let sslConfig = undefined;
	if (pgUrl.includes('ssl=') || pgUrl.includes('sslmode=') || pgUrl.includes('neon.tech')) {
		cleanPgUrl = pgUrl.split('?')[0];
		sslConfig = { rejectUnauthorized: false };
	}

	pool = new Pool({
		connectionString: cleanPgUrl,
		ssl: sslConfig,
		max: 10,
		idleTimeoutMillis: 30000,
	});
	pool.on('error', (err) => {
		console.error('[DB] Unexpected error on idle client:', err.message);
	});
} else {
	console.log('[DB] Connecting to local SQLite database for testing/fallback...');
	const sqlite3 = require('sqlite3').verbose();
	const dbFolder = path.resolve(__dirname, '../data');
	if (!fs.existsSync(dbFolder)) {
		fs.mkdirSync(dbFolder, { recursive: true });
	}
	const dbName = isTest ? `bot_test_${process.env.JEST_WORKER_ID || '1'}.db` : 'bot.db';
	dbPath = path.join(dbFolder, dbName);
	localDb = new sqlite3.Database(dbPath, (err) => {
		if (!err) {
			localDb.configure('busyTimeout', 10000);
			localDb.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
				if (pragmaErr) console.error('[DB] Failed to enable foreign keys:', pragmaErr.message);
				else console.log('[DB] Foreign key constraints enabled.');
			});
			localDb.run('PRAGMA busy_timeout = 10000;', (pragmaErr) => {
				if (pragmaErr) console.error('[DB] Failed to set busy timeout:', pragmaErr.message);
			});
		}
	});
}

/**
 * Dynamically converts SQLite queries to PostgreSQL compatible syntax.
 * Maps:
 * - INSERT OR IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING
 * - INSERT OR REPLACE INTO -> INSERT INTO ... ON CONFLICT (pkeys) DO UPDATE SET ...
 * - ? -> $1, $2, ...
 * - Appends RETURNING * to standard inserts to return insertId / lastID
 */
function convertQuery(sql) {
	let convertedSql = sql.trim();

	// 1. Convert INSERT OR IGNORE INTO to INSERT INTO ... ON CONFLICT DO NOTHING
	if (convertedSql.toUpperCase().startsWith('INSERT OR IGNORE INTO')) {
		convertedSql = convertedSql.replace(/INSERT OR IGNORE INTO/i, 'INSERT INTO');
		convertedSql = convertedSql + ' ON CONFLICT DO NOTHING';
	}
	// 2. Convert INSERT OR REPLACE INTO to ON CONFLICT (pk) DO UPDATE SET ...
	else if (convertedSql.toUpperCase().startsWith('INSERT OR REPLACE INTO')) {
		convertedSql = convertedSql.replace(/INSERT OR REPLACE INTO/i, 'INSERT INTO');
		
		const match = convertedSql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
		if (match) {
			const tableName = match[1].toLowerCase();
			const columnsStr = match[2];
			const columns = columnsStr.split(',').map(c => c.trim().toLowerCase());
			
			let pkCols = [];
			if (tableName === 'bot_settings') {
				pkCols = ['key'];
			} else if (tableName === 'meeting_reminders_sent') {
				pkCols = ['meeting_id', 'reminder_type'];
			} else if (tableName === 'meeting_attendance_pings') {
				pkCols = ['meeting_id', 'user_id'];
			} else if (tableName === 'pending_notion_profiles') {
				pkCols = ['discord_id', 'city'];
			} else if (tableName === 'meeting_email_preferences') {
				pkCols = ['discord_id'];
			} else if (tableName === 'meeting_transcripts') {
				pkCols = ['meeting_id'];
			} else if (tableName === 'push_subscriptions') {
				pkCols = ['endpoint'];
			} else {
				pkCols = ['id'];
			}
			
			const updateCols = columns.filter(c => !pkCols.includes(c));
			
			if (updateCols.length > 0) {
				const pkStr = pkCols.join(', ');
				const updateStr = updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');
				convertedSql = `${convertedSql} ON CONFLICT (${pkStr}) DO UPDATE SET ${updateStr}`;
			} else {
				const pkStr = pkCols.join(', ');
				convertedSql = `${convertedSql} ON CONFLICT (${pkStr}) DO NOTHING`;
			}
		}
	}

	// 3. Replace SQLite ? placeholders with $1, $2, ...
	let idx = 1;
	convertedSql = convertedSql.replace(/\?/g, () => `$${idx++}`);

	// 4. Append RETURNING * to standard INSERT queries to extract lastID
	const upper = convertedSql.toUpperCase();
	if (upper.startsWith('INSERT') && !upper.includes('RETURNING') && !upper.includes('DO NOTHING') && !upper.includes('DO UPDATE')) {
		convertedSql += ' RETURNING *';
	}

	return convertedSql;
}

function run(sql, params = []) {
	if (usePostgres) {
		const pgSql = convertQuery(sql);
		return pool.query(pgSql, params).then(res => {
			const lastID = res.rows[0]?.id || res.rows[0]?.insertId || null;
			return {
				lastID,
				changes: res.rowCount,
				rows: res.rows
			};
		});
	} else {
		return new Promise((resolve, reject) => {
			localDb.run(sql, params, function (err) {
				if (err) reject(err);
				else resolve(this);
			});
		});
	}
}

async function get(sql, params = []) {
	if (usePostgres) {
		const pgSql = convertQuery(sql);
		const result = await pool.query(pgSql, params);
		return result.rows[0] || null;
	} else {
		return new Promise((resolve, reject) => {
			localDb.get(sql, params, (err, row) => {
				if (err) reject(err);
				else resolve(row || null);
			});
		});
	}
}

async function all(sql, params = []) {
	if (usePostgres) {
		const pgSql = convertQuery(sql);
		const result = await pool.query(pgSql, params);
		return result.rows;
	} else {
		return new Promise((resolve, reject) => {
			localDb.all(sql, params, (err, rows) => {
				if (err) reject(err);
				else resolve(rows || []);
			});
		});
	}
}

function serialize(callback) {
	if (usePostgres) {
		callback();
	} else {
		localDb.serialize(callback);
	}
}

async function transaction(callback) {
	if (usePostgres) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const txWrapper = {
				execute: async (sqlOrObj, params) => {
					let sql, args;
					if (typeof sqlOrObj === 'object' && sqlOrObj !== null) {
						sql = sqlOrObj.sql;
						args = sqlOrObj.args || [];
					} else {
						sql = sqlOrObj;
						args = params || [];
					}
					const pgSql = convertQuery(sql);
					const result = await client.query(pgSql, args);
					const lastID = result.rows[0]?.id || result.rows[0]?.insertId || null;
					return {
						lastID,
						changes: result.rowCount,
						rows: result.rows
					};
				}
			};
			const res = await callback(txWrapper);
			await client.query('COMMIT');
			return res;
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});
			throw err;
		} finally {
			client.release();
		}
	} else {
		await run('BEGIN TRANSACTION');
		try {
			const res = await callback({
				execute: async (sqlOrObj, params) => {
					let sql, args;
					if (typeof sqlOrObj === 'object' && sqlOrObj !== null) {
						sql = sqlOrObj.sql;
						args = sqlOrObj.args || [];
					} else {
						sql = sqlOrObj;
						args = params || [];
					}
					return await run(sql, args);
				}
			});
			await run('COMMIT');
			return res;
		} catch (err) {
			await run('ROLLBACK').catch(() => {});
			throw err;
		}
	}
}

module.exports = {
	run,
	get,
	all,
	serialize,
	transaction,
	useTurso: false,
	usePostgres,
	dbPath,
	close() {
		if (localDb) localDb.close();
		if (pool) pool.end();
	}
};
