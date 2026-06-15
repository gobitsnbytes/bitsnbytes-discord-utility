const path = require('path');
const fs = require('fs');

require('dotenv').config();

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

const useTurso = !!(tursoUrl && tursoToken) && process.env.NODE_ENV !== 'test';

let localDb = null;
let remoteDb = null;
let dbPath = null;

if (useTurso) {
	console.log('[DB] Connecting to remote Turso database...');
	const { createClient } = require('@libsql/client');
	try {
		remoteDb = createClient({
			url: tursoUrl,
			authToken: tursoToken,
		});
	} catch (err) {
		console.error('[DB] Failed to initialize remote Turso database client:', err.message);
		process.exit(1);
	}
} else {
	console.log('[DB] Connecting to local SQLite database...');
	const sqlite3 = require('sqlite3').verbose();
	const dbFolder = path.resolve(__dirname, '../data');
	if (!fs.existsSync(dbFolder)) {
		fs.mkdirSync(dbFolder, { recursive: true });
	}
	const isTest = process.env.NODE_ENV === 'test';
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

function run(sql, params = []) {
	if (useTurso) {
		return remoteDb.execute({ sql, args: params });
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
	if (useTurso) {
		const res = await remoteDb.execute({ sql, args: params });
		return res.rows[0] || null;
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
	if (useTurso) {
		const res = await remoteDb.execute({ sql, args: params });
		return res.rows;
	} else {
		return new Promise((resolve, reject) => {
			localDb.all(sql, params, (err, rows) => {
				if (err) reject(err);
				else resolve(rows || []);
			});
		});
	}
}

// Helper to serialize schema creation for local SQLite
function serialize(callback) {
	if (useTurso) {
		callback();
	} else {
		localDb.serialize(callback);
	}
}

async function transaction(callback) {
	if (useTurso) {
		const tx = await remoteDb.transaction("write");
		try {
			const res = await callback(tx);
			await tx.commit();
			return res;
		} catch (err) {
			await tx.rollback().catch(() => {});
			throw err;
		} finally {
			tx.close();
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
	useTurso,
	dbPath,
	close() {
		if (localDb) localDb.close();
		if (remoteDb) remoteDb.close();
	}
};
