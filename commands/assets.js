const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('assets')
		.setDescription('Access the official B&B Node asset library.'),

	async execute(interaction) {
		const flags = config.PRIVACY['assets'] !== undefined ? (config.PRIVACY['assets'] ? [MessageFlags.Ephemeral] : []) : [MessageFlags.Ephemeral];
		
		const embed = new EmbedBuilder()
			.setTitle(`${config.EMOJIS.save} RESOURCE_TRANSMISSION // ASSET_PORTAL`)
			.setDescription('Direct access to official Bits&Bytes operational materials. Select a resource to initialize:')
			.setColor(config.COLORS.primary)
            .setThumbnail(interaction.guild.iconURL())
			.addFields(
				{ name: '⌬ BRAND_IDENTITY', value: 'Logos, fonts, and style guides.', inline: true },
				{ name: '⌬ TEMPLATES', value: 'Canva decks and social media kits.', inline: true },
				{ name: '⌬ INSTRUCTIONAL', value: 'Core curriculum and teaching guides.', inline: true }
			)
			.setFooter({ text: config.BRANDING.footerText })
			.setTimestamp();

		const brandButton = new ButtonBuilder()
			.setLabel('BRAND_ASSETS ↗️')
			.setURL('https://notion.so') // Placeholder
			.setStyle(ButtonStyle.Link);

		const templateButton = new ButtonBuilder()
			.setLabel('TEMPLATES ↗️')
			.setURL('https://canva.com') // Placeholder
			.setStyle(ButtonStyle.Link);

		const curriculumButton = new ButtonBuilder()
			.setLabel('CURRICULUM ↗️')
			.setURL('https://notion.so') // Placeholder
			.setStyle(ButtonStyle.Link);

		const row = new ActionRowBuilder().addComponents(brandButton, templateButton, curriculumButton);

		await interaction.reply({
			embeds: [embed],
			components: [row],
			flags
		});
	},
};
