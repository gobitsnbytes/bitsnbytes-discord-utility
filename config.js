/**
 * 🛰️ BITS&BYTES PROTOCOL - ELITE CONFIGURATION ENGINE
 * Version: 2.1.0 (Tactical Overhaul)
 */

module.exports = {
	// 🎨 TACTICAL PALETTE (Elite Tech Aesthetic - Clean & Professional)
	COLORS: {
		primary: '#97192c',    // Brand Pink / Burgundy Core
		secondary: '#120f0a',  // Brand Ink
		success: '#23a55a',    // Modern Emerald/Mint
		warning: '#ffae24',    // Brand Amber
		error: '#f04438',      // Destructive Red
		neutral: '#ff7a1b',    // Brand Coral (Accent)
	},

	// ⚛️ TACTICAL ICONOGRAPHY (Clean & Minimalist)
	EMOJIS: {
		protocol: '',          // Clean / No emoji
		node: '▪',             // Clean square bullet
		active: '🟢',          // Simple status dot
		pending: '🟡',         // Simple status dot
		archived: '📦',        // Archive box
		pulse: '⚡',           // Pulse/Activity
		save: '💾',            // Save
		help: '❓',            // Help
		link: '🔗',           // Link
		success: '🟢',         // Success
		warning: '🟡',         // Warning
		error: '🔴',           // Error
		health: '📈',          // Health
		team: '👥',            // Team
		event: '📅',           // Event
		report: '📝',          // Report
		badge: '🏆',           // Badge
		reminder: '🔔',        // Reminder
		onboarding: '📋',      // Onboarding
		leaderboard: '🏆',     // Leaderboard
		points: '⭐',          // Points
		calendar: '📅',        // Calendar
		city: '📍',            // City
		github: '💻',          // GitHub
		website: '🌐',         // Website
		partnership: '🤝',     // Partnership
	},

	// 📄 PROTOCOL BRANDING
	BRANDING: {
		version: '2.1.0',
		footerText: 'BITS&BYTES // SECURE_PROTOCOL_V2.1.0',
		documentationLabel: 'Bits&Bytes Wiki →',
	},

	// 🧬 CORE SERVER ROLE CONFIGURATIONS
	ROLE_IDS: {
		contributor: process.env.CONTRIBUTOR_ROLE_ID || '1506019068132462804',
	},

	// 🧬 CORE SERVER CHANNEL CONFIGURATIONS
	CHANNEL_IDS: {
		announcement: process.env.ANNOUNCEMENT_CHANNEL_ID || '1490415427409412376',
		events: process.env.EVENTS_CHANNEL_ID || '1508037242092912650',
		teamChat: process.env.TEAM_CHAT_CHANNEL_ID || '1490417184172806285',
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
		dashboard: true,
		help: true,
		pulse: true,
		archive: true,
		merge: true,
		'fork-request': true,
		'view-forks': false,
		// Missing command privacy keys
		assets: true,
		ping: true,
		'forks-info': false,
		'admin-add-lead': true,
		// New Phase 1 commands
		'fork-health': false,      // Public - shows network health
		'team-update': true,       // Private - team management
		'team-view': false,        // Public - shows team structure
		'fork-status': false,      // Public - shows fork dashboard
		// New Phase 2 commands
		'report-submit': true,     // Private - report submission
		'report-status': false,    // Public - shows report status
		'report-view': true,       // Private - view report details
		'event-create': true,      // Private - event creation
		'event-update': true,      // Private - event updates
		'event-status': false,     // Public - shows event pipeline
		'event-calendar': false,   // Public - shows network calendar
		'onboarding-status': false,// Public - shows onboarding progress
		'onboarding-complete': true,// Private - staff command
		// New Phase 3 commands
		leaderboard: false,        // Public - shows points leaderboard
		'fork-badges': false,      // Public - shows achievements
		'meet-email': true,        // Ephemeral - email registration
		'meet-schedule': true,     // Ephemeral - meeting scheduler
		'meet-transcript': true,   // Ephemeral - transcript retrieval
		'meet-start': true,        // Ephemeral - start meeting manually
		'meet-stop': true,         // Ephemeral - stop meeting manually
		'meet-reschedule': true,   // Ephemeral - reschedule meeting
		'ts-off': true             // Ephemeral - secret emergency recording abort
	},

	// 🎙️ MEETING RECORDING & TRANSCRIPTION
	RECORDING: {
		tempDir: require('path').join(require('os').tmpdir(), 'bnb-recordings'),
		maxConcurrentRecordings: 3,
		minMeetingDurationMs: 60 * 1000,    // 1 minute minimum
		postProcessingTimeoutMs: 40 * 60 * 1000, // 40 min max per pipeline (accounts for remote FFmpeg merges and Gemini)
		dmRateLimitMs: 1000,                // 1 DM per second
		consent: {
			audioEnglish: './assets/english.mp3',
			audioHindi: './assets/hindi.mp3',
			textEnglish: '⚠️ **Recording Notice & Consent Policy**\n\n> Please note that this meeting is being recorded by or on behalf of Bits&Bytes for lawful business, compliance, safeguarding, child protection, training, audit, and record-keeping purposes, in accordance with applicable legal frameworks. By continuing to participate in this voice channel, you acknowledge and explicitly consent to the recording of your voice, its subsequent transcription using automated systems (including third-party AI processors), and the secure storage and lawful use of this data. If any participant is a minor, participation must be with the consent and supervision of a parent or lawful guardian. If you do not consent to these terms, please disconnect from this voice channel immediately.',
			textHindi: '⚠️ **रिकॉर्डिंग सूचना और सहमति नीति**\n\n> कृपया ध्यान दें कि यह बैठक Bits&Bytes द्वारा या उसकी ओर से, लागू विधिक ढांचे के अनुसार, वैध व्यावसायिक, अनुपालन, सुरक्षा, बाल-सुरक्षा, प्रशिक्षण, लेखा-परीक्षा और अभिलेख-रखरखाव उद्देश्यों के लिए रिकॉर्ड की जा रही है। इस वॉइस चैनल में भाग लेना जारी रखने से, आप अपनी आवाज़ की रिकॉर्डिंग, स्वचालित प्रणालियों (तृतीय-पक्ष एआई प्रोसेसर सहित) का उपयोग करके इसके बाद के ट्रांसक्रिप्शन, और इस डेटा के सुरक्षित संग्रहण और वैध उपयोग के लिए स्पष्ट रूप से सहमति प्रदान करते हैं। यदि कोई प्रतिभागी नाबालिग है, तो उसकी भागीदारी माता-पिता या विधिक अभिभावक की सहमति और पर्यवेक्षण के साथ ही होनी चाहिए। यदि आप इन शर्तों से सहमत नहीं हैं, तो कृपया तुरंत इस वॉइस चैनल से डिस्कनेक्ट करें।',
		},
	},
	TRANSCRIPTION: {
		supportedLanguages: ['English', 'Hindi', 'Hinglish'],
		maxRetries: 3,
		retryBackoffMs: 2000,
		// gemini-3.5-flash may take longer for audio analysis on lengthy meetings
		transcriptionTimeoutMs: 30 * 60 * 1000,  // 30 min cap per Gemini call
	}
};
