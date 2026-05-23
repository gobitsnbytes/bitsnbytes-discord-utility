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

		const pages = [];
		const fieldsPerPage = 2;
		
		for (let i = 0; i < fields.length; i += fieldsPerPage) {
			const pageFields = fields.slice(i, i + fieldsPerPage);
			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.help} BITS&BYTES_OS // CMD_REFERENCE_V${config.BRANDING.version || '2.0'}`)
				.setDescription('Use this to see what each command does, plus who it is meant for.')
				.setColor(config.COLORS.primary)
				.setThumbnail(interaction.guild.iconURL())
				.addFields(pageFields)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });
			pages.push(embed);
		}

		if (pages.length === 0) {
			pages.push(new EmbedBuilder()
				.setTitle(`${config.EMOJIS.help} BITS&BYTES_OS // CMD_REFERENCE_V${config.BRANDING.version || '2.0'}`)
				.setDescription('No commands registered.')
				.setColor(config.COLORS.primary)
				.setFooter({ text: config.BRANDING.footerText }));
		}

		const button = new ButtonBuilder()
			.setLabel(config.BRANDING.documentationLabel)
			.setURL('https://www.notion.so/33949ed2fc33818ba073ffa2d815bf1a?v=33949ed2fc3380ccbfe2000c860aa29a&source=copy_link')
			.setStyle(ButtonStyle.Link);

		const extraRow = new ActionRowBuilder().addComponents(button);

		const { paginate } = require('../lib/pagination');
		await paginate(interaction, pages, config.PRIVACY.help, extraRow);
	},
};
