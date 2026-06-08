const { Events } = require('discord.js');

const rolesInProgress = new Set();

module.exports = {
	name: Events.MessageReactionAdd,
	async execute(reaction, user) {
		// If the reaction is partial, fetch it
		if (reaction.partial) {
			try {
				await reaction.fetch();
			} catch (error) {
				console.error('Something went wrong when fetching the reaction:', error);
				return;
			}
		}

		// Don't handle bot reactions
		if (user.bot) return;

		// Check if it's the role picker channel
		if (reaction.message.channel.name !== 'roles') return;

		// If the message is partial, fetch it
		if (reaction.message.partial) {
			try {
				await reaction.message.fetch();
			} catch (error) {
				console.error('Something went wrong when fetching the message:', error);
				return;
			}
		}

		// Handle City picker
		let matchedCity = null;

		const embeds = reaction.message.embeds;
		if (embeds && embeds.length > 0) {
			const embed = embeds[0];
			if (embed && embed.title === '📍 Pick Your City') {
				const field = embed.fields.find(f => f.name === 'Active Cities');
				if (field) {
					const lines = field.value.split('\n');
					const emojiName = reaction.emoji.name;
					for (const line of lines) {
						if (line.includes(emojiName)) {
							matchedCity = line.replace(emojiName, '').trim();
							break;
						}
					}
				}
			}
		}

		if (!matchedCity) return;

		try {
			const member = await reaction.message.guild.members.fetch(user.id);
			let role = reaction.message.guild.roles.cache.find(r => r.name.toLowerCase() === matchedCity.toLowerCase());
			if (!role) {
				if (rolesInProgress.has(matchedCity.toLowerCase())) {
					await new Promise(r => setTimeout(r, 1000));
					role = reaction.message.guild.roles.cache.find(r => r.name.toLowerCase() === matchedCity.toLowerCase())
						|| await reaction.message.guild.roles.fetch().then(() => reaction.message.guild.roles.cache.find(r => r.name.toLowerCase() === matchedCity.toLowerCase())).catch(() => null);
				}
				if (!role) {
					rolesInProgress.add(matchedCity.toLowerCase());
					try {
						role = await reaction.message.guild.roles.create({
							name: matchedCity,
							reason: `Automated creation of community city role for ${matchedCity}`
						});
					} catch (err) {
						console.error(`[ROLES] Failed to create community city role "${matchedCity}":`, err.message);
					} finally {
						rolesInProgress.delete(matchedCity.toLowerCase());
					}
				}
			}

			if (role) {
				await member.roles.add(role);
				console.log(`[ROLES] Added @${role.name} to ${user.tag}`);
			} else {
				console.log(`[WARNING] Role for "${matchedCity}" not found/created in guild.`);
			}
		} catch (error) {
			console.error(`[ROLES] Error adding role:`, error);
		}
	},
};
