/**
 * Push Notification Service
 * Uses the web-push library to send push notifications to subscribed clients.
 * VAPID keys must be configured in .env
 */

let webpush;
try {
	webpush = require('web-push');
} catch (e) {
	console.warn('[PUSH] web-push package not installed. Push notifications disabled.');
}

const meetingsDb = require('./meetingsDb');

// Configure VAPID details
if (webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
	webpush.setVapidDetails(
		process.env.VAPID_SUBJECT || 'mailto:hello@gobitsnbytes.org',
		process.env.VAPID_PUBLIC_KEY,
		process.env.VAPID_PRIVATE_KEY
	);
	console.log('[PUSH] Web Push configured with VAPID keys.');
} else {
	console.warn('[PUSH] VAPID keys not configured. Push notifications disabled.');
}

/**
 * Send push notification to a single subscription
 * @param {Object} subscription - { endpoint, keys: { p256dh, auth } }
 * @param {Object} payload - { title, body, icon, url, tag }
 */
async function sendPush(subscription, payload) {
	if (!webpush || !process.env.VAPID_PUBLIC_KEY) return;

	const pushPayload = JSON.stringify({
		title: payload.title || 'chrono',
		body: payload.body || '',
		icon: payload.icon || '/favicon.svg',
		badge: '/favicon.svg',
		url: payload.url || '/',
		tag: payload.tag || 'default',
		timestamp: Date.now()
	});

	try {
		await webpush.sendNotification(
			{
				endpoint: subscription.endpoint,
				keys: {
					p256dh: subscription.p256dh || subscription.keys?.p256dh,
					auth: subscription.auth || subscription.keys?.auth
				}
			},
			pushPayload
		);
	} catch (err) {
		if (err.statusCode === 410 || err.statusCode === 404) {
			// Subscription expired or invalid, remove it
			await meetingsDb.removePushSubscription(subscription.endpoint).catch(() => {});
			console.log(`[PUSH] Removed expired subscription: ${subscription.endpoint.substring(0, 50)}...`);
		} else {
			console.error('[PUSH] Send error:', err.message);
		}
	}
}

/**
 * Send push notification to a specific user (all their subscriptions)
 */
async function sendPushToUser(userId, payload) {
	if (!webpush || !process.env.VAPID_PUBLIC_KEY) return;

	const subscriptions = await meetingsDb.getPushSubscriptions(userId);
	for (const sub of subscriptions) {
		await sendPush(sub, payload);
	}
}

/**
 * Send push notification to multiple users
 */
async function sendPushToUsers(userIds, payload) {
	if (!webpush || !process.env.VAPID_PUBLIC_KEY || !userIds || userIds.length === 0) return;

	const subscriptions = await meetingsDb.getPushSubscriptionsForUsers(userIds);
	const promises = subscriptions.map(sub => sendPush(sub, payload));
	await Promise.allSettled(promises);
}

/**
 * Notify attendees about a meeting reschedule
 */
async function notifyReschedule(meeting, rescheduledByName) {
	const userIds = (meeting.attendees || [])
		.filter(a => a.type === 'user')
		.map(a => a.discordId);

	if (userIds.length === 0) return;

	const time = new Date(meeting.scheduled_time).toLocaleString('en-US', {
		timeZone: 'Asia/Kolkata',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		month: 'short',
		day: 'numeric'
	});

	await sendPushToUsers(userIds, {
		title: `🔄 Meeting Rescheduled`,
		body: `"${meeting.title}" moved to ${time} IST by ${rescheduledByName}`,
		url: meeting.meet_code ? `/m/${meeting.meet_code}` : '/',
		tag: `reschedule-${meeting.id}`
	});
}

/**
 * Notify attendees that a meeting is starting
 */
async function notifyMeetingStarting(meeting) {
	const userIds = (meeting.attendees || [])
		.filter(a => a.type === 'user')
		.map(a => a.discordId);

	if (userIds.length === 0) return;

	await sendPushToUsers(userIds, {
		title: `▶️ Meeting Starting Now`,
		body: `"${meeting.title}" is starting. Join the voice channel!`,
		url: meeting.meet_code ? `/m/${meeting.meet_code}` : '/',
		tag: `start-${meeting.id}`
	});
}

/**
 * Notify about a new instant meeting
 */
async function notifyInstantMeeting(meeting, creatorName) {
	const userIds = (meeting.attendees || [])
		.filter(a => a.type === 'user')
		.map(a => a.discordId);

	if (userIds.length === 0) return;

	await sendPushToUsers(userIds, {
		title: `⚡ Instant Meeting`,
		body: `${creatorName} started "${meeting.title}". Join now!`,
		url: meeting.meet_code ? `/m/${meeting.meet_code}` : '/',
		tag: `instant-${meeting.id}`
	});
}

module.exports = {
	sendPush,
	sendPushToUser,
	sendPushToUsers,
	notifyReschedule,
	notifyMeetingStarting,
	notifyInstantMeeting
};
