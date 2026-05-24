/**
 * 🗓️ BITS&BYTES PROTOCOL - CAL.COM API CLIENT
 * Version: 1.0.0
 * Purpose: Integrates Cal.com API v2 for scheduling and calendar synchronization
 */

const logger = require('./logger');

const CALCOM_BASE_URL = 'https://api.cal.com/v2';

function getHeaders() {
	const apiKey = process.env.CALCOM_API_KEY;
	if (!apiKey) {
		return null;
	}
	return {
		'Authorization': `Bearer ${apiKey}`,
		'cal-api-version': '2024-08-13',
		'Content-Type': 'application/json'
	};
}

/**
 * Fetch all upcoming bookings from Cal.com
 * @returns {Promise<Array>} - List of bookings
 */
async function getUpcomingBookings() {
	const headers = getHeaders();
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
	const headers = getHeaders();
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
	const headers = getHeaders();
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
	const headers = getHeaders();
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

module.exports = {
	getUpcomingBookings,
	createBooking,
	cancelBooking,
	getEventTypes
};
