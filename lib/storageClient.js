/**
 * 🪣 OCI Storage Client — Light-weight Object Storage interface using PAR (Pre-Authenticated Requests)
 * Part of the Bits&Bytes Meeting Transcript Agent
 * 
 * Uses only built-in Node.js modules to avoid adding runtime dependencies,
 * and streams files directly to/from disk to stay within VPS memory limits.
 */

const https = require('https');
const fs = require('fs');
const { URL } = require('url');

/**
 * Upload a local file to OCI Object Storage via PAR.
 * @param {string} objectName - Name of the object in the bucket (e.g., "segments/user_123.ogg")
 * @param {string} filePath - Local file path to upload
 * @returns {Promise<string>} The full URL of the uploaded object
 */
function uploadSegmentToPAR(objectName, filePath) {
	return new Promise((resolve, reject) => {
		try {
			const urlString = getFullUrl(objectName);
			const url = new URL(urlString);
			const stats = fs.statSync(filePath);
			
			const options = {
				method: 'PUT',
				hostname: url.hostname,
				path: url.pathname + url.search,
				headers: {
					'Content-Length': stats.size,
					'Content-Type': 'application/octet-stream'
				}
			};

			const req = https.request(options, (res) => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					resolve(urlString);
				} else {
					let body = '';
					res.on('data', chunk => body += chunk);
					res.on('end', () => {
						reject(new Error(`OCI upload failed with status ${res.statusCode}: ${body}`));
					});
				}
			});

			req.on('error', (err) => {
				reject(err);
			});

			const readStream = fs.createReadStream(filePath);
			readStream.on('error', (err) => {
				req.destroy();
				reject(err);
			});
			readStream.pipe(req);
		} catch (err) {
			reject(err);
		}
	});
}

/**
 * Download a file from a PAR URL and stream it directly to disk.
 * @param {string} downloadUrl - The full download PAR URL
 * @param {string} destPath - The local destination path
 * @returns {Promise<void>}
 */
function downloadFromPAR(downloadUrl, destPath) {
	return new Promise((resolve, reject) => {
		try {
			const url = new URL(downloadUrl);
			const fileStream = fs.createWriteStream(destPath);

			const req = https.get(url, (res) => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					res.pipe(fileStream);
					fileStream.on('finish', () => {
						fileStream.close();
						resolve();
					});
				} else {
					fileStream.close();
					fs.unlink(destPath, () => {}); // clean up partial file
					let body = '';
					res.on('data', chunk => body += chunk);
					res.on('end', () => {
						reject(new Error(`OCI download failed with status ${res.statusCode}: ${body}`));
					});
				}
			});

			req.on('error', (err) => {
				fileStream.close();
				fs.unlink(destPath, () => {});
				reject(err);
			});

			fileStream.on('error', (err) => {
				req.destroy();
				fs.unlink(destPath, () => {});
				reject(err);
			});
		} catch (err) {
			reject(err);
		}
	});
}

/**
 * Delete an object from OCI Object Storage via PAR.
 * @param {string} objectName - Name of the object to delete
 * @returns {Promise<void>}
 */
function deleteFromOCI(objectName) {
	return new Promise((resolve, reject) => {
		try {
			const urlString = getFullUrl(objectName);
			const url = new URL(urlString);

			const options = {
				method: 'DELETE',
				hostname: url.hostname,
				path: url.pathname + url.search
			};

			const req = https.request(options, (res) => {
				// OCI DELETE usually returns 204 No Content
				if (res.statusCode >= 200 && res.statusCode < 300) {
					resolve();
				} else {
					let body = '';
					res.on('data', chunk => body += chunk);
					res.on('end', () => {
						reject(new Error(`OCI delete failed with status ${res.statusCode}: ${body}`));
					});
				}
			});

			req.on('error', (err) => {
				reject(err);
			});

			req.end();
		} catch (err) {
			reject(err);
		}
	});
}

/**
 * Formulate full URL from base PAR URL and object path
 * @param {string} objectName 
 * @returns {string}
 */
function getFullUrl(objectName) {
	const baseUrl = process.env.OCI_PAR_BASE_URL;
	if (!baseUrl) {
		throw new Error('OCI_PAR_BASE_URL is not configured');
	}
	const cleanBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
	const cleanObject = objectName.startsWith('/') ? objectName.slice(1) : objectName;
	return cleanBase + cleanObject;
}

module.exports = {
	uploadSegmentToPAR,
	downloadFromPAR,
	deleteFromOCI
};
