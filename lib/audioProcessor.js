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

	console.log(`[AUDIO_PROCESSOR] Merging ${allSegments.length} segments from ${userSegments.length} users...`);

	// Build FFmpeg command
	const args = [];

	// Add input files
	for (const seg of allSegments) {
		args.push('-i', seg.file);
	}

	// Build filter graph:
	// 1. loudnorm per-track: equalises volume so quiet speakers aren't transcribed as [inaudible]
	// 2. adelay: offset each track to its correct position in the timeline
	// 3. amix: blend all tracks into a single mono channel (normalize=0 to preserve relative levels)
	const filterParts = [];
	const mixInputs = [];

	for (let i = 0; i < allSegments.length; i++) {
		const seg = allSegments[i];
		const delayMs = Math.max(0, seg.startedAt - meetingStartTime);
		const normalised = `[n${i}]`;

		// Step 1: loudnorm (I=-16 normalises to -16 LUFS; tp=-1.5 keeps peaks safe)
		filterParts.push(`[${i}]loudnorm=I=-16:TP=-1.5:LRA=11${normalised}`);

		if (delayMs > 0) {
			// Step 2: apply time offset delay
			filterParts.push(`${normalised}adelay=${delayMs}|${delayMs}[d${i}]`);
			mixInputs.push(`[d${i}]`);
		} else {
			mixInputs.push(normalised);
		}
	}

	// Combine all tracks with amix
	const amixFilter = `${mixInputs.join('')}amix=inputs=${allSegments.length}:duration=longest:normalize=0`;
	const fullFilter = filterParts.join(';') + ';' + amixFilter;

	args.push('-filter_complex', fullFilter);

	// Output settings:
	// - Opus codec in OGG container
	// - 16kHz sample rate: Gemini speech model is optimised for 16kHz; downsampling before upload
	//   reduces file size while maintaining (or improving) ASR accuracy for this use case
	// - 96kbps: higher than the previous 48k for better Hinglish consonant clarity
	// - Mono: single channel is sufficient and halves file size
	args.push(
		'-c:a', 'libopus',
		'-ar', '16000',
		'-b:a', '96k',
		'-ac', '1',
		'-y', // Overwrite output
		outputPath
	);

	// Run FFmpeg as child process (outside Node.js heap)
	await runFFmpeg(args);

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
			timeout: 120000, // 2 minute timeout
			maxBuffer: 5 * 1024 * 1024, // 5MB buffer for stderr logs
		}, (err, stdout, stderr) => {
			if (err) {
				console.error(`[AUDIO_PROCESSOR] FFmpeg error:`, err.message);
				if (stderr) {
					// Only log last 500 chars of stderr to avoid flooding
					const tail = stderr.length > 500 ? '...' + stderr.slice(-500) : stderr;
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
