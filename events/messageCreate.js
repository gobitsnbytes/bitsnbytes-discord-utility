const { Events, EmbedBuilder } = require('discord.js');

const inviteRegex = /(discord\.(gg|io|me|li)\/.+|discordapp\.com\/invite\/.+)/i;
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
