const { Events, EmbedBuilder } = require('discord.js');
const logger = require('../lib/logger');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		logger.init(client); // Re-init to trigger flush now that we are ready
		logger.boot(`Logged in as ${client.user.tag}`);

		const rolesChannel = client.channels.cache.find(c => c.name === 'roles');
		if (rolesChannel) {
			logger.info(`Found #roles channel (${rolesChannel.id}). Starting setup...`);
			try {
				// Delete old bot messages concurrently
				const messages = await rolesChannel.messages.fetch({ limit: 20 });
				const botMessages = messages.filter(m => m.author.id === client.user.id);
				logger.info(`Found ${botMessages.size} old messages to purge in #roles.`);
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
				
				logger.info('Posting reactions to #roles...');
				// React concurrently
				await Promise.all(emojis.map(emoji => sent.react(emoji).catch(() => {})));
				logger.info('Channel setup successful.');
			} catch (err) {
				logger.error('Roles setup failed', err);
			}
		} else {
			logger.warn('#roles channel not found.');
		}
	},
};
