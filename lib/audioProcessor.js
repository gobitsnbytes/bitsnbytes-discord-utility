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

module.exports = {
	mergeAudioSegments,
	getAudioDuration,
};
