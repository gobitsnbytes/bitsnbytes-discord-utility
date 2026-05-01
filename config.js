/**
 * 🛰️ BITS&BYTES PROTOCOL - ELITE CONFIGURATION ENGINE
 * Version: 2.0.0 (Tactical Overhaul)
 */

module.exports = {
	// 🎨 TACTICAL PALETTE (Elite Tech Aesthetic)
	COLORS: {
		primary: '#00F2FF',    // Atomic Cyan
		secondary: '#1A1A1A',  // Deep Space Charcoal
		success: '#00FF95',    // Matrix Green
		warning: '#FFCC00',    // Alert Amber
		error: '#FF0055',      // Protocol Breach Red
		neutral: '#555555',    // Slate Grey
	},

	// ⚛️ TACTICAL ICONOGRAPHY
	EMOJIS: {
		protocol: '⚛️',         // Protocol Core
		node: '⌬',             // Hex Node
		active: '○',           // Signal Strength - High
		pending: '●',          // Signal Strength - Initializing
		archived: '🗃️',         // Data Vault
		pulse: '⌁',            // Bio-Pulse / Signal
		save: '⬢',             // Storage / Request
		help: '⚙️',             // System Config
		link: '↗️',            // External Link
		// New emojis for extended features
		success: '✅',          // Success indicator
		warning: '⚠️',          // Warning indicator
		error: '❌',            // Error indicator
		health: '📊',           // Health/Analytics
		team: '👥',             // Team
		event: '📅',            // Events
		report: '📝',           // Reports
		badge: '🏅',            // Badges/Achievements
		reminder: '🔔',         // Reminders
		onboarding: '📋',       // Onboarding
		leaderboard: '🏆',      // Leaderboard
		points: '⭐',           // Points
		calendar: '📆',         // Calendar
		city: '🏙️',             // City/Location
		github: '🐙',           // GitHub
		website: '🌐',          // Website
		partnership: '🤝',      // Partnership
	},

	// 📄 PROTOCOL BRANDING
	BRANDING: {
		footerText: 'BITS&BYTES // SECURE_PROTOCOL_V2.0.0',
		documentationLabel: 'Fork Handbook →',
	},

	// 🖥️ SYSTEM INTERFACE SETTINGS
	UI: {
		useServerIcon: true,    // Identity verification
		terminalStyle: true,    // Tactical monospace interface
		minimalist: true,       // Strip unnecessary fluff
	},

	// 🛡️ SECURITY & PRIVACY MANAGEMENT
	// Set any command to 'false' to make its output public to the channel.
	// Set to 'true' to make it visible only to the user (ephemeral).
	PRIVACY: {
		// Original commands
		forks: true,
		help: true,
		pulse: true,
		archive: true,
		merge: true,
		'fork-request': true,
		'view-forks': false,
		// New Phase 1 commands
		'fork-health': false,      // Public - shows network health
		'team-update': true,       // Private - team management
		'team-view': false,        // Public - shows team structure
		'fork-status': false,      // Public - shows fork dashboard
		// New Phase 2 commands
		'report-submit': true,     // Private - report submission
		'report-status': false,    // Public - shows report status
		'event-create': true,      // Private - event creation
		'event-update': true,      // Private - event updates
		'event-status': false,     // Public - shows event pipeline
		'event-calendar': false,   // Public - shows network calendar
		'onboarding-status': false,// Public - shows onboarding progress
		'onboarding-complete': true,// Private - staff command
		// New Phase 3 commands
		leaderboard: false,        // Public - shows points leaderboard
		'fork-badges': false,      // Public - shows achievements
	}
};
