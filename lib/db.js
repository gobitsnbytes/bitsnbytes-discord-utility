const path = require('path');
const fs = require('fs');

require('dotenv').config();

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

const useTurso = !!(tursoUrl && tursoToken) && process.env.NODE_ENV !== 'test';

let localDb = null;
let remoteDb = null;

if (useTurso) {
	console.log('[DB] Connecting to remote Turso database...');
	const { createClient } = require('@libsql/client');
	remoteDb = createClient({
		url: tursoUrl,
		authToken: tursoToken,
	});
} else {
	console.log('[DB] Connecting to local SQLite database...');
	const sqlite3 = require('sqlite3').verbose();
	const dbFolder = path.resolve(__dirname, '../data');
	if (!fs.existsSync(dbFolder)) {
		fs.mkdirSync(dbFolder, { recursive: true });
	}
	const dbPath = path.join(dbFolder, 'bot.db');
	localDb = new sqlite3.Database(dbPath);
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

module.exports = {
	run,
	get,
	all,
	serialize,
	useTurso,
	close() {
		if (localDb) localDb.close();
		if (remoteDb) remoteDb.close();
	}
};
