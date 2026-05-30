/**
 * chrono — Service Worker
 * Handles push notifications and offline caching for the PWA.
 */

const CACHE_NAME = 'chrono-v1';
const STATIC_ASSETS = [
	'/',
	'/style.css',
	'/favicon.svg'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
	);
	self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(keys =>
			Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
		)
	);
	self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	if (url.pathname.startsWith('/api/')) {
		// Network only for API calls
		return;
	}

	event.respondWith(
		fetch(event.request)
			.then(response => {
				if (response && response.status === 200 && response.type === 'basic') {
					const clone = response.clone();
					caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
				}
				return response;
			})
			.catch(() => caches.match(event.request))
	);
});

// Push: handle incoming push notifications
self.addEventListener('push', (event) => {
	let data = { title: 'chrono', body: 'You have a new notification.' };

	try {
		if (event.data) {
			data = event.data.json();
		}
	} catch (e) {
		data.body = event.data ? event.data.text() : data.body;
	}

	const options = {
		body: data.body,
		icon: data.icon || '/favicon.svg',
		badge: data.badge || '/favicon.svg',
		tag: data.tag || 'default',
		data: {
			url: data.url || '/',
			timestamp: data.timestamp || Date.now()
		},
		vibrate: [100, 50, 100],
		requireInteraction: true,
		actions: [
			{ action: 'open', title: 'View' },
			{ action: 'dismiss', title: 'Dismiss' }
		]
	};

	event.waitUntil(
		self.registration.showNotification(data.title, options)
	);
});

// Notification click: open the relevant page
self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	if (event.action === 'dismiss') return;

	const urlToOpen = event.notification.data?.url || '/';

	event.waitUntil(
		clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
			// If a window with the URL is already open, focus it
			for (const client of windowClients) {
				if (client.url.includes(urlToOpen) && 'focus' in client) {
					return client.focus();
				}
			}
			// Otherwise open a new window
			return clients.openWindow(urlToOpen);
		})
	);
});
