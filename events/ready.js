const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`[READY] Logged in as ${client.user.tag}`);

		const rolesChannel = client.channels.cache.find(c => c.name === 'roles');
		if (rolesChannel) {
			console.log(`[ROLES] Found #roles channel (${rolesChannel.id}). Starting setup...`);
			try {
				// Delete old bot messages concurrently
				const messages = await rolesChannel.messages.fetch({ limit: 20 });
				const botMessages = messages.filter(m => m.author.id === client.user.id);
				console.log(`[ROLES] Found ${botMessages.size} old messages to purge.`);
				await Promise.all(botMessages.map(msg => msg.delete().catch(() => {})));

				const embed = new EmbedBuilder()
					.setTitle('🎯 Pick Your Interests')
					.setDescription('React below to get your interest roles!')
					.addFields(
						{ name: 'Interest Roles', value: '💻 dev  |  🎨 design  |  🔬 research  |  ⚙️ ops' }
					)
					.setColor('#5865F2');

				const sent = await rolesChannel.send({ embeds: [embed] });
				const emojis = ['💻', '🎨', '🔬', '⚙️'];
				
				console.log('[ROLES] Posting reactions...');
				// React concurrently
				await Promise.all(emojis.map(emoji => sent.react(emoji).catch(() => {})));
				console.log('[ROLES] Channel setup successful.');
			} catch (err) {
				console.error('[ROLES ERROR] Setup failed:', err.message);
			}
		} else {
			console.log('[ROLES WARNING] #roles channel not found.');
		}
	},
};
