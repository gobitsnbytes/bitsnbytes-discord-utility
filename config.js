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
	},

	// 📄 PROTOCOL BRANDING
	BRANDING: {
		footerText: 'BITS&BYTES // SECURE_PROTOCOL_V2.0.0',
		documentationLabel: 'ACCESS_API_REFERENCE',
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
		forks: true,
		help: true,
		pulse: true,
		archive: true,
		merge: true,
		'fork-request': true,
		'view-forks': false,
	}
};
