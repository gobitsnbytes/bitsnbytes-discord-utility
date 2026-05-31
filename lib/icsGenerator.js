/**
 * 📅 BITS&BYTES PROTOCOL - ICS CALENDAR GENERATOR
 * Version: 1.0.0
 * Purpose: Generates iCalendar (.ics) format files for Google/Apple/Outlook Calendar
 */

function formatICSTime(timestamp) {
	const d = new Date(timestamp);
	const year = d.getUTCFullYear();
	const month = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	const hours = String(d.getUTCHours()).padStart(2, '0');
	const minutes = String(d.getUTCMinutes()).padStart(2, '0');
	const seconds = String(d.getUTCSeconds()).padStart(2, '0');
	return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function escapeICSString(str) {
	if (!str) return '';
	return str
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '');
}

/**
 * Generate iCalendar format string for a meeting
 * @param {Object} meeting - The meeting object from the database
 * @param {string} guildId - The guild ID (optional)
 * @returns {string} - ICS format string
 */
function generateICS(meeting, guildId = '') {
	const startTime = formatICSTime(meeting.scheduled_time);
	
	// Determine duration (end_time - scheduled_time, or default 30 mins)
	let durationMs = 30 * 60 * 1000;
	if (meeting.end_time && meeting.scheduled_time) {
		durationMs = meeting.end_time - meeting.scheduled_time;
	}
	const endTime = formatICSTime(meeting.scheduled_time + durationMs);
	const timestamp = formatICSTime(Date.now());
	
	const title = escapeICSString(meeting.title);
	const description = escapeICSString(meeting.description || 'No agenda provided.');
	
	let location = 'Discord VC';
	if (meeting.meet_code) {
		location = `https://cal.gobitsnbytes.org/m/${meeting.meet_code}`;
	} else if (meeting.location_type === 'discord_vc') {
		if (guildId && meeting.temp_channel_id) {
			location = `Discord VC (https://discord.com/channels/${guildId}/${meeting.temp_channel_id})`;
		} else {
			location = 'Discord VC (Temporary Channel)';
		}
	} else if (meeting.location_details) {
		location = meeting.location_details;
	}

	const uid = meeting.calcom_booking_id || meeting.calcom_uid || meeting.id;

	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//BitsBytes//Bot//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:REQUEST',
		'BEGIN:VEVENT',
		`UID:${uid}@gobitsnbytes.org`,
		`DTSTAMP:${timestamp}`,
		`DTSTART:${startTime}`,
		`DTEND:${endTime}`,
		`SUMMARY:${title}`,
		`DESCRIPTION:${description}`,
		`LOCATION:${location}`,
		'STATUS:CONFIRMED',
		'SEQUENCE:0',
		'END:VEVENT',
		'END:VCALENDAR'
	].join('\r\n');
}

module.exports = {
	generateICS
};
