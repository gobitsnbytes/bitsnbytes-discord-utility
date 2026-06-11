const { Events, EmbedBuilder } = require('discord.js');

const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discordapp\.com\/invite\/.+)/i;

// Self-promo and spam keywords (case-insensitive)
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
	'stipend',
	'$',
	'prize money',
	'registration link',
	'sign up now',
	'win prize',
	'hackathon registration',
	'submit your project',
	'register at',
	'free v-bucks',
	'free nitro',
	'discord nitro',
	'steam gift',
	'gift card'
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
	'discord.com'
];

// Blocked URL patterns (external promo/spam)
const blockedUrlPatterns = [
	/hackathon/i,
	/ event /i,
	/ registration/i,
	/winners?/i,
	/prize/i,
	/stipend/i,
	/certificate/i
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

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;

		const guild = message.guild;
		if (!guild) return;

		const opsChannel = guild.channels.cache.find(c => c.name === 'team-ops');

		// 1. Block external Discord invite links
		if (inviteRegex.test(message.content)) {
			await message.delete();
			await message.channel.send(`🚫 <@${message.author.id}>, external Discord invites are not allowed.`);
			if (opsChannel) {
				const logEmbed = new EmbedBuilder()
					.setTitle('🛡️ Automod: Invite Link Filtered')
					.addFields(
						{ name: 'User', value: `${message.author.tag} (${message.author.id})` },
						{ name: 'Channel', value: message.channel.toString() }
					)
					.setColor('#E74C3C');
				await opsChannel.send({ embeds: [logEmbed] });
			}
			return;
		}

		// 1.5: Block self-promo and spam keywords
		const lowerContent = message.content.toLowerCase();
		const matchedKeywords = spamKeywords.filter(keyword => lowerContent.includes(keyword.toLowerCase()));
		
		if (matchedKeywords.length > 0) {
			await message.delete();
			await message.channel.send(`🚫 <@${message.author.id}>, self-promotion and spam are not allowed.`);
			if (opsChannel) {
				const logEmbed = new EmbedBuilder()
					.setTitle('🛡️ Automod: Self-Promo/Spam Filtered')
					.addFields(
						{ name: 'User', value: `${message.author.tag} (${message.author.id})` },
						{ name: 'Channel', value: message.channel.toString() },
						{ name: 'Matched', value: matchedKeywords.join(', ') }
					)
					.setColor('#E74C3C');
				await opsChannel.send({ embeds: [logEmbed] });
			}
			return;
		}

		// 1.6: Block suspicious external links (hackathon, prizes, etc.)
		const urlRegex = /(https?:\/\/[^\s]+)/g;
		const urls = message.content.match(urlRegex) || [];
		
		for (const url of urls) {
			// Check if URL is from allowed domains
			const isAllowed = allowedDomains.some(domain => url.includes(domain));
			if (isAllowed) continue;
			
			// Check if URL matches blocked patterns
			const isBlocked = blockedUrlPatterns.some(pattern => pattern.test(url));
			if (isBlocked) {
				await message.delete();
				await message.channel.send(`🚫 <@${message.author.id}>, links to external events/registrations are not allowed.`);
				if (opsChannel) {
					const logEmbed = new EmbedBuilder()
						.setTitle('🛡️ Automod: Suspicious Link Filtered')
						.addFields(
							{ name: 'User', value: `${message.author.tag} (${message.author.id})` },
							{ name: 'Channel', value: message.channel.toString() },
							{ name: 'URL', value: url.substring(0, 100) }
						)
						.setColor('#E74C3C');
					await opsChannel.send({ embeds: [logEmbed] });
				}
				return;
			}
		}

		// 2. Block mass mentions (5+)
		if (message.mentions.users.size >= 5) {
			await message.delete();
			await message.channel.send(`🚫 <@${message.author.id}>, your message was flagged for mass mentions.`);
			if (opsChannel) {
				const logEmbed = new EmbedBuilder()
					.setTitle('🛡️ Automod: Mass Mentions Filtered')
					.addFields(
						{ name: 'User', value: `${message.author.tag} (${message.author.id})` },
						{ name: 'Count', value: message.mentions.users.size.toString() }
					)
					.setColor('#E74C3C');
				await opsChannel.send({ embeds: [logEmbed] });
			}
			return;
		}

		// 3. Spam filter: 5+ messages in 5 seconds
		const now = Date.now();
		const userStats = userMessageCounts.get(message.author.id) || { count: 0, timestamp: now };

		if (now - userStats.timestamp < 5000) {
			userStats.count++;
		} else {
			userStats.count = 1;
			userStats.timestamp = now;
		}
		userMessageCounts.set(message.author.id, userStats);

		if (userStats.count >= 5) {
			try {
				await message.member.timeout(10 * 60 * 1000, 'Spam detected'); // 10-minute timeout
				await message.channel.send(`🤐 <@${message.author.id}> has been timed out for 10 minutes due to spam.`);
				if (opsChannel) {
					const logEmbed = new EmbedBuilder()
						.setTitle('🛡️ Automod: Spam Timeout')
						.addFields(
							{ name: 'User', value: `${message.author.tag} (${message.author.id})` }
						)
						.setColor('#E74C3C');
					await opsChannel.send({ embeds: [logEmbed] });
				}
			} catch (e) {
				console.log(`[AUTOMOD] Could not timeout user ${message.author.tag}. Maybe I'm missing permissions?`);
			}
		}
	},
};
