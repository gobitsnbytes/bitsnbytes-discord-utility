const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);

		const rolesChannel = client.channels.cache.find(c => c.name === 'roles');
		if (rolesChannel) {
			// Delete old bot messages so a fresh one is posted
			const messages = await rolesChannel.messages.fetch({ limit: 20 });
			const botMessages = messages.filter(m => m.author.id === client.user.id);
			for (const [, msg] of botMessages) {
				await msg.delete().catch(() => {});
			}

			const embed = new EmbedBuilder()
				.setTitle('🎯 Pick Your Interests')
				.setDescription('React below to get your interest roles!')
				.addFields(
					{ name: 'Interest Roles', value: '💻 dev  |  🎨 design  |  🔬 research  |  ⚙️ ops' }
				)
				.setColor('#5865F2');

			const sent = await rolesChannel.send({ embeds: [embed] });
			const emojis = ['💻', '🎨', '🔬', '⚙️'];
			for (const emoji of emojis) {
				await sent.react(emoji);
			}
			console.log('[ROLES] Posted interest roles picker.');
		} else {
			console.log('[WARNING] #roles channel not found.');
		}
	},
};
