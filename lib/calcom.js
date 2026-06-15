/**
 * 🗓️ BITS&BYTES PROTOCOL - CAL.COM API CLIENT
 * Version: 1.0.0
 * Purpose: Integrates Cal.com API v2 for scheduling and calendar synchronization
 */

const logger = require('./logger');

const CALCOM_BASE_URL = 'https://api.cal.com/v2';

function getHeaders(version = '2024-06-14') {
	const apiKey = process.env.CALCOM_API_KEY;
	if (!apiKey) {
		return null;
	}
	return {
		'Authorization': `Bearer ${apiKey}`,
		'cal-api-version': version,
		'Content-Type': 'application/json'
	};
}

/**
 * Fetch all upcoming bookings from Cal.com
 * @returns {Promise<Array>} - List of bookings
 */
async function getUpcomingBookings() {
	const headers = getHeaders('2024-08-13');
	if (!headers) return [];

	try {
		const res = await fetch(`${CALCOM_BASE_URL}/bookings?status=upcoming`, { headers });
		if (!res.ok) {
			const errText = await res.text();
			logger.warn(`[CALCOM] Failed to fetch bookings: ${res.status} ${errText}`);
			return [];
		}
		const data = await res.json();
		// API v2 returns { status: "success", data: [...] } or { status: "success", data: { bookings: [...] } }
		if (data && data.data) {
			return data.data.bookings || data.data || [];
		}
		return data.bookings || data || [];
	} catch (error) {
		logger.error('[CALCOM] Error fetching bookings', error);
		return [];
	}
}

/**
 * Push a new booking to Cal.com
 * @param {Object} bookingData - Booking details
 * @returns {Promise<Object|null>} - Created booking details or null
 */
async function createBooking(bookingData) {
	const headers = getHeaders('2024-08-13');
	if (!headers) return null;

	try {
		const res = await fetch(`${CALCOM_BASE_URL}/bookings`, {
			method: 'POST',
			headers,
			body: JSON.stringify(bookingData)
		});
		if (!res.ok) {
			const errText = await res.text();
			logger.warn(`[CALCOM] Failed to create booking: ${res.status} ${errText}`);
			return null;
		}
		const data = await res.json();
		return data.data || data.booking || data;
	} catch (error) {
		logger.error('[CALCOM] Error creating booking', error);
		return null;
	}
}

/**
 * Cancel a booking on Cal.com
 * @param {string} bookingUid - The booking UID to cancel
 * @param {string} reason - Cancellation reason
 * @returns {Promise<boolean>} - True if cancelled successfully
 */
async function cancelBooking(bookingUid, reason = 'Cancelled via Discord bot') {
	const headers = getHeaders('2024-08-13');
	if (!headers) return false;

	try {
		const res = await fetch(`${CALCOM_BASE_URL}/bookings/${bookingUid}/cancel`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ cancellationReason: reason })
		});
		if (!res.ok) {
			const errText = await res.text();
			logger.warn(`[CALCOM] Failed to cancel booking ${bookingUid}: ${res.status} ${errText}`);
			return false;
		}
		return true;
	} catch (error) {
		logger.error(`[CALCOM] Error cancelling booking ${bookingUid}`, error);
		return false;
	}
}

/**
 * Get available event types
 * @returns {Promise<Array>} - List of event types
 */
async function getEventTypes() {
	const headers = getHeaders('2024-06-14');
	if (!headers) return [];

	try {
		const res = await fetch(`${CALCOM_BASE_URL}/event-types`, { headers });
		if (!res.ok) {
			const errText = await res.text();
			logger.warn(`[CALCOM] Failed to fetch event types: ${res.status} ${errText}`);
			return [];
		}
		const data = await res.json();
		if (data && data.data) {
			return data.data.eventTypes || data.data || [];
		}
		return data.eventTypes || data || [];
	} catch (error) {
		logger.error('[CALCOM] Error fetching event types', error);
		return [];
	}
}

/**
 * Get available slots for an event type from Cal.com
 * @param {string|number} eventTypeId - Event type ID
 * @param {string} startTime - Start time (ISO 8601 UTC)
 * @param {string} endTime - End time (ISO 8601 UTC)
 * @returns {Promise<Object>} - Slots data by date
 */
async function getSlots(eventTypeId, startTime, endTime, duration) {
	const headers = getHeaders('2024-09-04');
	if (!headers) return {};

	try {
		let url = `${CALCOM_BASE_URL}/slots?eventTypeId=${eventTypeId}&start=${startTime}&end=${endTime}`;
		if (duration) {
			url += `&duration=${duration}`;
		}
		const res = await fetch(url, { headers });
		if (!res.ok) {
			const errText = await res.text();
			logger.warn(`[CALCOM] Failed to fetch slots: ${res.status} ${errText}`);
			return {};
		}
		const data = await res.json();
		return data.data || data;
	} catch (error) {
		logger.error('[CALCOM] Error fetching slots from Cal.com', error);
		return {};
	}
}

/**
 * Update the location of an existing booking on Cal.com
 * @param {string} bookingUid - The booking UID
 * @param {string} locationUrl - The custom redirect URL
 * @returns {Promise<boolean>} - True if updated successfully
 */
async function updateBookingLocation(bookingUid, locationUrl) {
	const headers = getHeaders('2024-08-13');
	if (!headers) return false;

	try {
		const res = await fetch(`${CALCOM_BASE_URL}/bookings/${bookingUid}/location`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify({
				location: {
					type: 'link',
					link: locationUrl
				}
			})
		});
		if (!res.ok) {
			const errText = await res.text();
			logger.warn(`[CALCOM] Failed to update booking location for ${bookingUid}: ${res.status} ${errText}`);
			return false;
		}
		return true;
	} catch (error) {
		logger.error(`[CALCOM] Error updating booking location for ${bookingUid}`, error);
		return false;
	}
}

/**
 * Update the start/end time of a booking on Cal.com
 * @param {string} bookingUid - The booking UID
 * @param {string} startTimeIso - The new start time in ISO 8601 format
 * @param {string} endTimeIso - The new end time in ISO 8601 format
 * @returns {Promise<boolean>} - True if updated successfully
 */
async function updateBookingTime(bookingUid, startTimeIso, endTimeIso) {
	const headers = getHeaders('2024-08-13');
	if (!headers) return false;

	try {
		const res = await fetch(`${CALCOM_BASE_URL}/bookings/${bookingUid}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify({
				start: startTimeIso,
				end: endTimeIso
			})
		});
		if (!res.ok) {
			const errText = await res.text();
			logger.warn(`[CALCOM] Failed to update booking time for ${bookingUid}: ${res.status} ${errText}`);
			return false;
		}
		return true;
	} catch (error) {
		logger.error(`[CALCOM] Error updating booking time for ${bookingUid}`, error);
		return false;
	}
}

module.exports = {
	getUpcomingBookings,
	createBooking,
	cancelBooking,
	getEventTypes,
	getSlots,
	updateBookingLocation,
	updateBookingTime
};
