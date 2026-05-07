const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('Show what each command does and who can use it.'),

	async execute(interaction) {
		const { commands } = interaction.client;
		
		const publicCmds = [];
		const forkCmds = [];
		const staffCmds = [];
		const fields = [];

		const formatUsage = (command) => {
			const options = command.data.options?.map(option => (
				option.required ? `<${option.name}>` : `[${option.name}]`
			)).join(' ');
			return options ? `\`/${command.data.name} ${options}\`` : `\`/${command.data.name}\``;
		};

		const getAudience = (commandName) => {
			if (['merge', 'archive', 'onboarding-complete'].includes(commandName)) return 'Staff only';
			if (['pulse', 'forks'].includes(commandName)) return 'Fork leads';
			return 'Everyone';
		};

		commands.forEach(command => {
			const entry = `${formatUsage(command)} — ${command.data.description} (${getAudience(command.data.name)})`;
			if (['merge', 'archive', 'onboarding-complete'].includes(command.data.name)) {
				staffCmds.push(entry);
			} else if (['pulse', 'forks'].includes(command.data.name)) {
				forkCmds.push(entry);
			} else {
				publicCmds.push(entry);
			}
		});

		const pushChunkedFields = (name, entries) => {
			let current = '';
			let part = 1;

			for (const entry of entries) {
				const next = current ? `${current}\n\n${entry}` : entry;
				if (next.length > 1024) {
					fields.push({
						name: part === 1 ? name : `${name} (${part})`,
						value: current,
					});
					current = entry;
					part += 1;
				} else {
					current = next;
				}
			}

			if (current) {
				fields.push({
					name: part === 1 ? name : `${name} (${part})`,
					value: current,
				});
			}
		};

		pushChunkedFields('🌐 PUBLIC_INTERFACE', publicCmds);
		pushChunkedFields('🛠️ NODE_OPERATIONS', forkCmds);
		pushChunkedFields('🛡️ ROOT_ACCESS_ONLY', staffCmds);

		const embed = new EmbedBuilder()
			.setTitle(`${config.EMOJIS.help} BITS&BYTES_OS // CMD_REFERENCE_V${config.BRANDING.version || '2.0'}`)
			.setDescription('Use this to see what each command does, plus who it is meant for.')
			.setColor(config.COLORS.primary)
            .setThumbnail(interaction.guild.iconURL())
			.addFields(fields.length ? fields : [{ name: 'Commands', value: '*EMPTY*' }])
			.setTimestamp()
            .setFooter({ text: config.BRANDING.footerText });

        const button = new ButtonBuilder()
            .setLabel(config.BRANDING.documentationLabel)
            .setURL(process.env.FORK_HANDBOOK_URL || 'https://notion.so')
            .setStyle(ButtonStyle.Link);

        const row = new ActionRowBuilder().addComponents(button);

		await interaction.reply({ 
            embeds: [embed], 
            components: [row],
            flags: config.PRIVACY.help ? [MessageFlags.Ephemeral] : []
        });
	},
};
