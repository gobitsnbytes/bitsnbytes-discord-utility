/**
 * 🛰️ BITS&BYTES PROTOCOL - ELITE CONFIGURATION ENGINE
 * Version: 2.0.0 (Tactical Overhaul)
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
		footerText: 'BITS&BYTES // SECURE_PROTOCOL_V2.0.0',
		documentationLabel: 'Bits&Bytes Wiki →',
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
		'meet-email': true,        // Ephemeral - email registration
		'meet-schedule': true,     // Ephemeral - meeting scheduler
		'meet-transcript': true,   // Ephemeral - transcript retrieval
		'meet-start': true,        // Ephemeral - start meeting manually
		'meet-reschedule': true,   // Ephemeral - reschedule meeting
		'ts-off': true             // Ephemeral - secret emergency recording abort
	},

	// 🎙️ MEETING RECORDING & TRANSCRIPTION
	RECORDING: {
		tempDir: require('path').join(require('os').tmpdir(), 'bnb-recordings'),
		maxConcurrentRecordings: 3,
		minMeetingDurationMs: 60 * 1000,    // 1 minute minimum
		postProcessingTimeoutMs: 5 * 60 * 1000, // 5 min max per pipeline
		dmRateLimitMs: 1000,                // 1 DM per second
		consent: {
			audioEnglish: './assets/english.mp3',
			audioHindi: './assets/hindi.mp3',
			textEnglish: '⚠️ **Recording Notice**\n\n> Please note that this meeting is being recorded by or on behalf of the Company for lawful business, compliance, safeguarding, child protection, training, audit, and record-keeping purposes, in accordance with applicable Indian law. If any participant is a minor, participation must be with the consent and supervision of a parent or lawful guardian, and the recording may be accessed or shared only on a need-to-know basis and in line with applicable law and safeguarding policy. By continuing to participate, you acknowledge and consent to such recording, transcription, storage, and lawful use to the extent permitted by law.',
			textHindi: '⚠️ **रिकॉर्डिंग सूचना**\n\n> कृपया ध्यान दें कि यह बैठक कंपनी द्वारा या उसकी ओर से, लागू भारतीय कानून के अनुसार, वैध व्यावसायिक, अनुपालन, सुरक्षा, बाल-सुरक्षा, प्रशिक्षण, लेखा-परीक्षा और अभिलेख-रखरखाव उद्देश्यों के लिए रिकॉर्ड की जा रही है। यदि कोई प्रतिभागी नाबालिग है, तो उसकी भागीदारी माता-पिता या विधिक अभिभावक की सहमति और पर्यवेक्षण के साथ ही होनी चाहिए, और रिकॉर्डिंग का उपयोग/साझाकरण केवल आवश्यकता-आधारित, गोपनीय तरीके से तथा लागू कानून और सुरक्षा नीति के अनुसार किया जाएगा। इस बैठक में भाग लेना जारी रखने के द्वारा, आप कानून द्वारा अनुमत सीमा तक ऐसी रिकॉर्डिंग, ट्रांसक्रिप्शन, संग्रहण और वैध उपयोग के लिए अपनी सहमति और स्वीकृति प्रदान करते हैं।',
		},
	},
	TRANSCRIPTION: {
		supportedLanguages: ['English', 'Hindi', 'Hinglish'],
		maxRetries: 3,
		retryBackoffMs: 2000,
	}
};
