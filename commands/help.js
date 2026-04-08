const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('List all available commands and bot features.'),

	async execute(interaction) {
		const commands = interaction.client.commands;
		
		const publicCmds = [];
		const forkCmds = [];
		const staffCmds = [];

		commands.forEach(command => {
			const name = `\`/${command.data.name}\``;
			const description = command.data.description;
			const entry = `${name} — ${description}`;

			// Categorization logic
			if (['merge', 'archive'].includes(command.data.name)) {
				staffCmds.push(entry);
			} else if (command.data.name === 'pulse') {
				forkCmds.push(entry);
			} else {
				publicCmds.push(entry);
			}
		});

		const helpEmbed = new EmbedBuilder()
			.setColor('#5865F2') // Bits&Bytes Secondary Blue
			.setTitle('🍴 bits&bytes bot — operations layer')
			.setDescription('we run hackathons, design/dev squads, and real products. here is how you can use the bot:')
			.addFields(
				{ 
					name: '🌐 public commands', 
					value: publicCmds.join('\n') || '*no public commands available*' 
				},
				{ 
					name: '🛠️ fork operations', 
					value: forkCmds.join('\n') || '*no fork commands available*' 
				},
				{ 
					name: '🛡️ staff only', 
					value: staffCmds.join('\n') || '*no staff commands available*' 
				},
				{ 
					name: '✨ other features', 
					value: [
						'→ **reaction roles**: head to <#roles> to pick your city/interests.',
						'→ **welcome dms**: new members get an automatic intro guide.',
						'→ **automod**: keeping the server clean and safe.'
					].join('\n')
				}
			)
			.setFooter({ 
				text: 'built for bits&bytes — gobitsnbytes.org', 
				iconURL: interaction.client.user.displayAvatarURL() 
			})
			.setTimestamp();

		return await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
	},
};
