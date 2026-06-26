const crypto = require('crypto');
const fs = require('fs');

function canonicalPath(path) {
	const p = path.endsWith('/') ? path.slice(0, -1) : path;
	return p || '/';
}

function signRequest(method, path, userId, timestamp, secret) {
	const message = `${timestamp}${method.toUpperCase()}${canonicalPath(path)}${userId}`;
	return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Call Motherboard API with signed internal headers.
 * 
 * @param {string} method - HTTP method (GET, POST, PATCH, etc.)
 * @param {string} path - API endpoint path (e.g. /api/meetings/schedule)
 * @param {string} userId - Discord User ID of initiator (or 'discord_bot')
 * @param {Object} [body] - JSON request body
 * @param {Object} [files] - Object of { name: filePath } for file upload
 * @returns {Promise<any>} Response JSON
 */
async function callMotherboard(method, path, userId, body = null, files = null) {
	const apiUrl = process.env.MOTHERBOARD_API_URL || 'http://localhost:8000';
	const url = `${apiUrl}${path}`;
	const timestamp = String(Math.floor(Date.now() / 1000));
	const secret = process.env.API_INTERNAL_SECRET;

	if (!secret) {
		throw new Error('[MOTHERBOARD_API] API_INTERNAL_SECRET is not configured on Discord Bot');
	}

	const pathOnly = path.split('?')[0];
	const signature = signRequest(method, pathOnly, userId, timestamp, secret);

	const headers = {
		'X-Internal-User-Id': userId,
		'X-Internal-Timestamp': timestamp,
		'X-Internal-Signature': signature,
	};

	const options = {
		method: method.toUpperCase(),
		headers,
	};

	if (files) {
		const formData = new FormData();
		for (const [key, filePath] of Object.entries(files)) {
			if (fs.existsSync(filePath)) {
				const fileBuffer = fs.readFileSync(filePath);
				const fileBlob = new Blob([fileBuffer], { type: 'application/octet-stream' });
				formData.append(key, fileBlob, filePath.split(/[/\\]/).pop());
			}
		}
		if (body) {
			formData.append('metadata', JSON.stringify(body));
		}
		options.body = formData;
	} else if (body) {
		options.headers['Content-Type'] = 'application/json';
		options.body = JSON.stringify(body);
	}

	const res = await fetch(url, options);
	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`Motherboard API error (${res.status}): ${errText}`);
	}

	return await res.json();
}

module.exports = { callMotherboard };
