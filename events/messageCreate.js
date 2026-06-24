const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config');

const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discordapp\.com\/invite\/.+)/i;

// Self-promo and spam keywords (case-insensitive)
// Keep these specific — avoid single-word triggers that staff use legitimately
const spamKeywords = [
	'join my server',
	'check out my server',
	'discord server',
	'follow my instagram',
	'follow me on',
	'subscribe to my',
	'donate to me',
	'paypal.me',
	'ko-fi.com',
	'buy me a coffee',
	'prize money',
	'win prize',
	'free v-bucks',
	'free nitro',
	'discord nitro',
	'steam gift',
	'gift card',
];

// Allowed domains (whitelist)
const allowedDomains = [
	'github.com',
	'gitlab.com',
	'stackoverflow.com',
	'replit.com',
	'codesandbox.io',
	'netlify.app',
	'vercel.app',
	'render.com',
	'heroku.com',
	'localhost',
	'youtu.be',
	'youtube.com',
	'discord.com',
	'notion.so',
	'gobitsnbytes.org',
	'cal.gobitsnbytes.org',
];

// Blocked URL patterns (external promo/spam) — only match full URLs, not message text
const blockedUrlPatterns = [
	/hackathon/i,
	/\/register/i,
	/\/winners/i,
	/\/prize/i,
	/\/stipend/i,
];

const userMessageCounts = new Map();

// Periodic cleanup to avoid memory leaks
setInterval(() => {
	const now = Date.now();
	for (const [id, stats] of userMessageCounts) {
		if (now - stats.timestamp > 60000) {
			userMessageCounts.delete(id);
		}
	}
}, 60000);

/**
 * Check if a guild member is staff (has STAFF_ROLE_ID or is server admin).
 * Staff are fully exempt from all automod actions.
 */
function isStaff(member) {
	if (!member) return false;
	if (member.permissions.has('Administrator')) return true;
	const staffRoleId = process.env.STAFF_ROLE_ID || config.ROLE_IDS?.staff;
	if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
	// Also exempt exec leader and dep lead roles
	const exemptRoles = [
		'1506019032015310949', // exec_leader
		'1506323726223016149', // dep_lead
		process.env.STAFF_ROLE_ID,
	].filter(Boolean);
	return exemptRoles.some(id => member.roles.cache.has(id));
}

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;

		const guild = message.guild;
		if (!guild) return;

		// Staff are fully exempt from all automod
		if (isStaff(message.member)) return;

		const opsChannel = guild.channels.cache.find(c => c.name === 'team-ops');

		// 1. Block external Discord invite links
		if (inviteRegex.test(message.content)) {
			await message.delete().catch(() => {});
			await message.channel.send(`🚫 <@${message.author.id}>, external Discord invites are not allowed.`);
			if (opsChannel) {
				await opsChannel.send({
					embeds: [new EmbedBuilder()
						.setTitle('🛡️ Automod: Invite Link Filtered')
						.addFields(
							{ name: 'User', value: `${message.author.tag} (${message.author.id})` },
							{ name: 'Channel', value: message.channel.toString() }
						)
						.setColor(config.COLORS.error)],
				});
			}
			return;
		}

		// 2. Block self-promo / spam keywords
		const lowerContent = message.content.toLowerCase();
		const matchedKeywords = spamKeywords.filter(keyword => lowerContent.includes(keyword.toLowerCase()));

		if (matchedKeywords.length > 0) {
			await message.delete().catch(() => {});
			await message.channel.send(`🚫 <@${message.author.id}>, self-promotion and spam are not allowed.`);
			if (opsChannel) {
				await opsChannel.send({
					embeds: [new EmbedBuilder()
						.setTitle('🛡️ Automod: Self-Promo/Spam Filtered')
						.addFields(
							{ name: 'User', value: `${message.author.tag} (${message.author.id})` },
							{ name: 'Channel', value: message.channel.toString() },
							{ name: 'Matched', value: matchedKeywords.join(', ') }
						)
						.setColor(config.COLORS.error)],
				});
			}
			return;
		}

		// 3. Block suspicious external links (hackathon promos, prize pages, etc.)
		//    Only fires on URLs from non-whitelisted domains matching blocked patterns
		const urlRegex = /(https?:\/\/[^\s]+)/g;
		const urls = message.content.match(urlRegex) || [];

		for (const url of urls) {
			const isAllowed = allowedDomains.some(domain => url.includes(domain));
			if (isAllowed) continue;

			const isBlocked = blockedUrlPatterns.some(pattern => pattern.test(url));
			if (isBlocked) {
				await message.delete().catch(() => {});
				await message.channel.send(`🚫 <@${message.author.id}>, links to external events/registrations are not allowed.`);
				if (opsChannel) {
					await opsChannel.send({
						embeds: [new EmbedBuilder()
							.setTitle('🛡️ Automod: Suspicious Link Filtered')
							.addFields(
								{ name: 'User', value: `${message.author.tag} (${message.author.id})` },
								{ name: 'Channel', value: message.channel.toString() },
								{ name: 'URL', value: url.substring(0, 100) }
							)
							.setColor(config.COLORS.error)],
					});
				}
				return;
			}
		}

		// 4. Spam filter: 6+ messages in 5 seconds → 10-minute timeout
		//    (raised threshold from 5 to 6 to reduce false positives)
		const now = Date.now();
		const userStats = userMessageCounts.get(message.author.id) || { count: 0, timestamp: now };

		if (now - userStats.timestamp < 5000) {
			userStats.count++;
		} else {
			userStats.count = 1;
			userStats.timestamp = now;
		}
		userMessageCounts.set(message.author.id, userStats);

		if (userStats.count >= 6) {
			try {
				await message.member.timeout(10 * 60 * 1000, 'Spam detected');
				await message.channel.send(`🤐 <@${message.author.id}> has been timed out for 10 minutes due to spam.`);
				if (opsChannel) {
					await opsChannel.send({
						embeds: [new EmbedBuilder()
							.setTitle('🛡️ Automod: Spam Timeout')
							.addFields(
								{ name: 'User', value: `${message.author.tag} (${message.author.id})` }
							)
							.setColor(config.COLORS.error)],
					});
				}
			} catch (e) {
				console.log(`[AUTOMOD] Could not timeout user ${message.author.tag}: ${e.message}`);
			}
		}
	},
};
