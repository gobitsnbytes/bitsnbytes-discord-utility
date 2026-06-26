const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');
const logger = require('../lib/logger');
const { queueTranscription } = require('../lib/transcriptionPipeline');

async function runRecovery(client) {
	logger.info('[RECOVERY] Running meeting recovery checks...');
	try {
		const guildId = process.env.GUILD_ID;
		if (!guildId) {
			logger.warn('[RECOVERY] Skipping recovery: No GUILD_ID set.');
			return;
		}

		const guild = await client.guilds.fetch(guildId).catch(() => null);
		if (!guild) {
			logger.warn('[RECOVERY] Skipping recovery: Guild not found.');
			return;
		}

		// 1. Fetch meetings that are in 'recording' or 'processing' status in SQLite/Turso
		const activeMeetings = await meetingsDb.getActiveMeetings();
		const baseDir = config.RECORDING?.tempDir || path.join(require('os').tmpdir(), 'bnb-recordings');
		
		const now = Date.now();
		const staleThresholdMs = 3 * 60 * 60 * 1000; // 3 hours ago

		for (const meeting of activeMeetings) {
			const meetingId = meeting.id;
			const createdTimeMs = meeting.created_at || meeting.scheduled_time || now;
			const timeDiffMs = now - createdTimeMs;

			// Check if meeting is older than 3 hours (indicating it crashed or timed out)
			if (timeDiffMs > staleThresholdMs) {
				logger.warn(`[RECOVERY] Found stale/crashed meeting: "${meeting.title}" (${meetingId}), active for ${Math.round(timeDiffMs / 3600000)}h`);

				const meetingDir = path.join(baseDir, meetingId);
				const metadataPath = path.join(meetingDir, 'metadata.json');

				if (fs.existsSync(metadataPath)) {
					logger.info(`[RECOVERY] Recovering meeting "${meeting.title}" using saved metadata.json...`);
					try {
						const rawData = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
						const recordingData = {
							...rawData,
							speakers: new Map(Object.entries(rawData.speakers || {}))
						};
						
						// Enqueue transcription recovery
						await queueTranscription(meeting, recordingData, client);
						logger.info(`[RECOVERY] Successfully queued transcription recovery for meeting: ${meetingId}`);
					} catch (err) {
						logger.error(`[RECOVERY] Failed to restore metadata for meeting ${meetingId}:`, err);
						// Mark meeting as failed if metadata is corrupt
						await meetingsDb.updateRecordingStatus(meetingId, 'failed').catch(() => {});
						await meetingsDb.updateMeetingStatus(meetingId, 'completed').catch(() => {});
					}
				} else {
					logger.warn(`[RECOVERY] No metadata.json found for stale meeting ${meetingId}. Marking as failed.`);
					await meetingsDb.updateRecordingStatus(meetingId, 'failed').catch(() => {});
					await meetingsDb.updateMeetingStatus(meetingId, 'completed').catch(() => {});
					// Also clean up any orphan directory
					if (fs.existsSync(meetingDir)) {
						fs.rmSync(meetingDir, { recursive: true, force: true });
					}
				}
			}
		}
	} catch (err) {
		logger.error('[RECOVERY] Error during meeting recovery checks:', err);
	}
}

const boot = (client) => {
	// Schedule to run every 3 hours
	cron.schedule('0 */3 * * *', async () => {
		await runRecovery(client);
	});

	// Trigger immediate recovery run on startup
	setTimeout(async () => {
		logger.info('[RECOVERY] Triggering initial startup recovery run...');
		await runRecovery(client);
	}, 10000); // Wait 10 seconds after boot to let client fully stabilize
};

module.exports = boot;
module.exports.runRecovery = runRecovery;
