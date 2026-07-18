/**
 * 🔊 Audio Processor — Post-meeting audio merging via FFmpeg
 * Part of the Bits&Bytes Meeting Transcript Agent
 * 
 * Merges per-user Opus/OGG audio segments into a single mixed audio file
 * using FFmpeg child process (runs outside Node.js heap for memory safety).
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const mergeCallbackEmitter = new EventEmitter();
const meetingDirMap = new Map();

/**
 * Merge multiple per-user audio segments into a single mixed audio file.
 * Uses FFmpeg's adelay + amix filters to correctly offset and mix all tracks.
 * 
 * @param {Array<{userId: string, displayName: string, segments: Array<{file: string, startedAt: number, endedAt: number}>}>} userSegments
 * @param {string} meetingDir - Directory containing audio files
 * @param {number} meetingStartTime - Timestamp when the meeting recording started
 * @returns {Promise<{mergedFilePath: string, durationSeconds: number}>}
 */
async function mergeAudioSegments(userSegments, meetingDir, meetingStartTime) {
	const outputPath = path.join(meetingDir, 'merged_meeting.ogg');

	// Collect all valid segment files
	const allSegments = [];
	for (const user of userSegments) {
		for (const seg of user.segments) {
			if (fs.existsSync(seg.file) && fs.statSync(seg.file).size > 500) {
				allSegments.push({
					file: seg.file,
					startedAt: seg.startedAt,
					userId: user.userId,
					displayName: user.displayName,
				});
			}
		}
	}

	if (allSegments.length === 0) {
		throw new Error('No valid audio segments to merge');
	}

	// Single segment — just copy, no merge needed
	if (allSegments.length === 1) {
		console.log(`[AUDIO_PROCESSOR] Single segment — copying directly`);
		fs.copyFileSync(allSegments[0].file, outputPath);
		const duration = await getAudioDuration(outputPath);
		return { mergedFilePath: outputPath, durationSeconds: duration };
	}

	console.log(`[AUDIO_PROCESSOR] Merging ${allSegments.length} segments from ${userSegments.length} users with single-pass FFmpeg...`);

	// Sort segments chronologically by startedAt
	allSegments.sort((a, b) => a.startedAt - b.startedAt);

	const ffmpegArgs = [];
	const filterGraphParts = [];
	
	// Add inputs and build delay filters
	for (let i = 0; i < allSegments.length; i++) {
		ffmpegArgs.push('-i', allSegments[i].file);
		const delayMs = Math.max(0, allSegments[i].startedAt - meetingStartTime);
		filterGraphParts.push(`[${i}]adelay=${delayMs}|${delayMs}[a${i}]`);
	}
	
	// Mix inputs together using amix
	const mixInputs = filterGraphParts.map((_, i) => `[a${i}]`).join('');
	filterGraphParts.push(`${mixInputs}amix=inputs=${allSegments.length}:duration=longest:normalize=0[mixed]`);
	
	// Apply single loudnorm pass and resample
	filterGraphParts.push(`[mixed]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=16000[out]`);
	
	const filterComplex = filterGraphParts.join('; ');
	
	ffmpegArgs.push(
		'-filter_complex', filterComplex,
		'-map', '[out]',
		'-c:a', 'libopus',
		'-ar', '16000',
		'-b:a', '96k',
		'-ac', '1',
		'-y',
		outputPath
	);

	await runFFmpeg(ffmpegArgs);

	// Get duration of merged file
	const durationSeconds = await getAudioDuration(outputPath);

	console.log(`[AUDIO_PROCESSOR] ✅ Merged ${allSegments.length} segments → ${path.basename(outputPath)} (${durationSeconds}s)`);

	return { mergedFilePath: outputPath, durationSeconds };
}

/**
 * Get the duration of an audio file in seconds using ffprobe.
 * 
 * @param {string} filePath - Path to the audio file
 * @returns {Promise<number>} Duration in seconds
 */
async function getAudioDuration(filePath) {
	return new Promise((resolve, reject) => {
		execFile('ffprobe', [
			'-v', 'quiet',
			'-show_entries', 'format=duration',
			'-of', 'default=noprint_wrappers=1:nokey=1',
			filePath
		], { timeout: 30000 }, (err, stdout, stderr) => {
			if (err) {
				console.warn(`[AUDIO_PROCESSOR] ffprobe error:`, err.message);
				// Fallback: estimate from file size (Opus at ~48kbps ≈ 6KB/s)
				try {
					const stats = fs.statSync(filePath);
					const estimatedDuration = Math.round(stats.size / 6000);
					resolve(estimatedDuration);
				} catch {
					resolve(0);
				}
				return;
			}

			const duration = parseFloat(stdout.trim());
			resolve(isNaN(duration) ? 0 : Math.round(duration));
		});
	});
}

/**
 * Run FFmpeg with the given arguments.
 * 
 * @param {string[]} args - FFmpeg command-line arguments
 * @returns {Promise<void>}
 */
function runFFmpeg(args) {
	return new Promise((resolve, reject) => {
		console.log(`[AUDIO_PROCESSOR] Running FFmpeg with ${args.length} arguments...`);

		const process = execFile('ffmpeg', args, {
			timeout: 1800000, // 30 minute timeout to prevent kills on very long meetings/low-end CPUs
			maxBuffer: 5 * 1024 * 1024, // 5MB buffer for stderr logs
		}, (err, stdout, stderr) => {
			if (err) {
				console.error(`[AUDIO_PROCESSOR] FFmpeg error:`, err.message);
				if (stderr) {
					// Log last 5000 chars of stderr to give sufficient context for debugging
					const tail = stderr.length > 5000 ? '...' + stderr.slice(-5000) : stderr;
					console.error(`[AUDIO_PROCESSOR] FFmpeg stderr: ${tail}`);
				}
				reject(new Error(`FFmpeg failed: ${err.message}`));
				return;
			}
			resolve();
		});
	});
}

/**
 * Remote version of mergeAudioSegments that offloads FFmpeg mixing to GitHub Actions.
 * 
 * @param {Array} userSegments 
 * @param {string} meetingDir 
 * @param {number} meetingStartTime 
 * @param {string} meetingId 
 * @returns {Promise<{mergedFilePath: string, durationSeconds: number, segmentObjectNames: Array<string>}>}
 */
async function mergeAudioSegmentsRemote(userSegments, meetingDir, meetingStartTime, meetingId) {
	const outputPath = path.join(meetingDir, 'merged_meeting.ogg');

	// Collect all valid segment files
	const allSegments = [];
	for (const user of userSegments) {
		for (const seg of user.segments) {
			if (fs.existsSync(seg.file) && fs.statSync(seg.file).size > 500) {
				allSegments.push({
					file: seg.file,
					startedAt: seg.startedAt,
					userId: user.userId,
					displayName: user.displayName,
				});
			}
		}
	}

	if (allSegments.length === 0) {
		throw new Error('No valid audio segments to merge');
	}

	// Single segment shortcut
	if (allSegments.length === 1) {
		console.log(`[AUDIO_PROCESSOR] Single segment — copying locally and skipping remote merge`);
		fs.copyFileSync(allSegments[0].file, outputPath);
		const duration = await getAudioDuration(outputPath);
		return { mergedFilePath: outputPath, durationSeconds: duration, segmentObjectNames: [] };
	}

	console.log(`[AUDIO_PROCESSOR] Offloading merge for ${allSegments.length} segments of meeting ${meetingId} to GitHub Actions...`);

	// 1. Generate secure segment URLs pointing back to the VPS
	const uploadedSegments = [];
	const vpsBaseUrl = process.env.VPS_BASE_URL || 'https://cal.gobitsnbytes.org';
	const callbackSecret = process.env.FFMPEG_CALLBACK_SECRET;

	if (!callbackSecret) {
		throw new Error('FFMPEG_CALLBACK_SECRET is not configured in .env');
	}

	for (let i = 0; i < allSegments.length; i++) {
		const seg = allSegments[i];
		const filename = path.basename(seg.file);
		
		// Secure URL pointing back to our VPS temp-audio route
		const url = `${vpsBaseUrl}/temp-audio/${meetingId}/${filename}?token=${callbackSecret}`;
		
		uploadedSegments.push({
			url,
			startedAt: seg.startedAt,
			userId: seg.userId,
			displayName: seg.displayName
		});
	}

	// 2. Prepare callback URL pointing back to our PUT webhook
	const callbackUrl = `${vpsBaseUrl}/webhook/ffmpeg-done`;
	
	const dispatchPayload = {
		event_type: 'merge-audio',
		client_payload: {
			meetingId,
			segments: uploadedSegments,
			callbackUrl,
			meetingStartTime
		}
	};

	// 3. Dispatch GitHub Actions workflow
	const dispatchUrl = 'https://api.github.com/repos/gobitsnbytes/motherboard/dispatches';
	const dispatchToken = process.env.GITHUB_DISPATCH_TOKEN;
	if (!dispatchToken) {
		throw new Error('GITHUB_DISPATCH_TOKEN is not configured in .env');
	}

	console.log(`[AUDIO_PROCESSOR] Dispatching workflow for meeting ${meetingId} to GitHub API...`);
	const res = await fetch(dispatchUrl, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${dispatchToken}`,
			'Accept': 'application/vnd.github.v3+json',
			'User-Agent': 'Bits-Bytes-Bot',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(dispatchPayload)
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`GitHub dispatch failed (${res.status}): ${errText}`);
	}

	console.log(`[AUDIO_PROCESSOR] Workflow successfully dispatched. Waiting for callback...`);

	// 4. Store meetingDir in map for callback download lookup
	meetingDirMap.set(meetingId, { meetingDir });

	// 5. Wait for webhook callback via event emitter
	return new Promise((resolve, reject) => {
		const timeoutDuration = 40 * 60 * 1000; // 40 minutes backup timeout
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for GitHub Actions merge callback (40 minutes limit reached)`));
		}, timeoutDuration);

		const callbackKey = `merge-done:${meetingId}`;
		
		function onMergeDone(result) {
			cleanup();
			if (result.success) {
				getAudioDuration(result.localPath)
					.then(durationSeconds => {
						resolve({
							mergedFilePath: result.localPath,
							durationSeconds,
							segmentObjectNames: []
						});
					})
					.catch(err => {
						reject(new Error(`Failed to read merged file duration: ${err.message}`));
					});
			} else {
				reject(new Error(`Remote FFmpeg merge failed: ${result.error}`));
			}
		}

		function cleanup() {
			clearTimeout(timer);
			mergeCallbackEmitter.off(callbackKey, onMergeDone);
			meetingDirMap.delete(meetingId);
		}

		mergeCallbackEmitter.once(callbackKey, onMergeDone);
	});
}

module.exports = {
	mergeAudioSegments,
	mergeAudioSegmentsRemote,
	getAudioDuration,
	mergeCallbackEmitter,
	meetingDirMap,
};

