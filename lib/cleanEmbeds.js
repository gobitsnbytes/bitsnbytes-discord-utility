/**
 * 🛰️ BITS&BYTES PROTOCOL - EMBED CLEANER & DESIGN SYSTEM
 * Version: 1.0.0
 * Purpose: Automatically sanitizes, de-cringes, and cleans up all Discord Embeds.
 *          Removes screaming uppercase text, pseudo-hacker decorations, and excessive decorative emojis.
 */

const { EmbedBuilder } = require('discord.js');

const cleanText = (text) => {
    if (!text || typeof text !== 'string') return text;

    // Remove variation selectors (uFE0F, etc.)
    let cleaned = text.replace(/[\uFE00-\uFE0F]/g, '');

    // Remove all emojis using unicode property escapes
    cleaned = cleaned.replace(/\p{Extended_Pictographic}/gu, '').trim();

    // Remove specific characters that are not emojis but are vibe symbols
    cleaned = cleaned.replace(/[⌬⌁⬢○●]/g, '').trim();

    // Remove any leading/trailing special characters like colons, dashes, slashes, or whitespace
    cleaned = cleaned.replace(/^[:\-\/\s]+|[:\-\/\s]+$/g, '').trim();

    // Map specific vibe-coded titles/strings to professional versions
    const mapping = {
        'PROTOCOL_UNAUTHORIZED': 'Unauthorized Access',
        'ADMIN_FORCE_MERGE // DIRECT_ONBOARD': 'Direct Onboarding Completed',
        'BITS&BYTES // NETWORK_NODES': 'Network Nodes',
        'NODE_TOPOLOGY // NET_STATUS_RECAP': 'Network Topology Status',
        'PENDING_ONBOARDINGS': 'Pending Onboardings',
        'FORK_ONBOARDING_STATUS': 'Fork Onboarding Status',
        'ROOT_ACCESS_ONLY': 'Administrative Commands',
        'PUBLIC_INTERFACE': 'Public Commands',
        'NODE_OPERATIONS': 'Node Operator Commands',
        'BITS&BYTES_OS // CMD_REFERENCE_V2.0': 'Command Reference',
        'BITS&BYTES_OS // CMD_REFERENCE_V': 'Command Reference',
        'MEETING_CANCELLED // WEBHOOK': 'Meeting Cancelled',
        'MEETING_IMPORTED // WEBHOOK': 'Meeting Scheduled',
        'MEETING_RESCHEDULED // WEBHOOK': 'Meeting Rescheduled',
        'MEETING_IMPORTED // CALCOM_SYNC': 'Meeting Scheduled',
        'MEETING_CANCELLED // CALCOM_SYNC': 'Meeting Cancelled',
        'MEETING_RESCHEDULED // CALCOM_SYNC': 'Meeting Rescheduled',
        'MEETING_CANCELLED': 'Meeting Cancelled',
        'MEETING_IMPORTED': 'Meeting Scheduled',
        'MEETING_RESCHEDULED': 'Meeting Rescheduled',
        'ACTIVE_PROTOCOLS': 'Active Nodes',
        'NETWORK_DISCOVERY': 'Pending Nodes',
    };

    // Check direct matching or partial matching
    for (const [key, val] of Object.entries(mapping)) {
        if (cleaned.includes(key)) {
            cleaned = cleaned.replace(key, val);
        }
    }

    // Clean up generic vibe-coded headers: replace " // " with " — "
    if (cleaned.includes(' // ')) {
        const parts = cleaned.split(' // ');
        cleaned = parts.map(p => formatVibeWord(p)).join(' — ');
    } else {
        cleaned = formatVibeWord(cleaned);
    }

    // Clean up double spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned.trim();
};

const formatVibeWord = (word) => {
    if (word.startsWith('<@') || word.startsWith('`')) return word;
    
    // If it's screaming (all uppercase, allows spaces, dashes, underscores, colons, slashes, periods)
    if (/^[A-Z0-9_\-\s:\/\.]+$/.test(word) && /[A-Z]/.test(word)) {
        return word.split(/([_\-\s:\/\.])/)
            .map(part => {
                if (/^[A-Z0-9]+$/.test(part)) {
                    if (part.length <= 3 && !['AND', 'FOR', 'THE', 'OUT'].includes(part)) {
                        return part; // keep VC, OS, ID, etc.
                    }
                    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
                }
                return part;
            })
            .join('')
            .replace(/_/g, ' ') // replace remaining underscores with space
            .replace(/\s+/g, ' ')
            .trim();
    }
    return word;
};

// Monkey-patch EmbedBuilder prototype methods
const originalSetTitle = EmbedBuilder.prototype.setTitle;
EmbedBuilder.prototype.setTitle = function (title) {
    return originalSetTitle.call(this, cleanText(title));
};

const originalSetDescription = EmbedBuilder.prototype.setDescription;
EmbedBuilder.prototype.setDescription = function (description) {
    if (typeof description === 'string') {
        let cleanedDesc = description.replace(/⌬/g, '▪');
        cleanedDesc = cleanedDesc.replace(/[⚛⌁⬢○●]/g, '');
        return originalSetDescription.call(this, cleanedDesc);
    }
    return originalSetDescription.call(this, description);
};

const originalAddFields = EmbedBuilder.prototype.addFields;
EmbedBuilder.prototype.addFields = function (...fields) {
    const cleanedFields = [];
    const flatFields = Array.isArray(fields[0]) ? fields[0] : fields;

    for (const field of flatFields) {
        if (field && typeof field === 'object') {
            const name = cleanText(field.name);
            let value = field.value;
            if (typeof value === 'string') {
                value = value.replace(/⌬/g, '▪');
                value = value.replace(/[⚛⌁⬢○●]/g, '');
            }
            cleanedFields.push({
                name,
                value,
                inline: field.inline
            });
        }
    }
    return originalAddFields.call(this, cleanedFields);
};

const originalSetAuthor = EmbedBuilder.prototype.setAuthor;
EmbedBuilder.prototype.setAuthor = function (options) {
    if (options && typeof options === 'object' && options.name) {
        options.name = cleanText(options.name);
    }
    return originalSetAuthor.call(this, options);
};

const originalSetFooter = EmbedBuilder.prototype.setFooter;
EmbedBuilder.prototype.setFooter = function (options) {
    if (options && typeof options === 'object' && options.text) {
        options.text = cleanText(options.text);
    }
    return originalSetFooter.call(this, options);
};

module.exports = {
    cleanText
};
