const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
const auth = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('pulse')
		.setDescription('Submit a structured activity update for your fork.')
		.addStringOption(option => option.setName('city').setDescription('The city for the fork').setRequired(true))
		.addStringOption(option => option.setName('update').setDescription('The update details (text)').setRequired(true)),

	async execute(interaction) {
		const city = interaction.options.getString('city');
		const updateText = interaction.options.getString('update');
		const guild = interaction.guild;

		const flags = config.PRIVACY.pulse ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			// Enforce authorization check for the city node
			const isAuthorized = await auth.isAuthorizedForCity(interaction.user, city, guild);
			if (!isAuthorized) {
				const unauthorizedEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
					.setDescription(`Your credentials do not grant access to broadcast pulses for the **${city.toUpperCase()}** node.`)
					.setColor(config.COLORS.error)
					.setFooter({ text: config.BRANDING.footerText });
				return await interaction.editReply({ embeds: [unauthorizedEmbed] });
			}

			// 1. Post to #pulse
			const pulseChannel = guild.channels.cache.find(c => c.name === 'pulse');
			if (pulseChannel) {
				const pulseEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.pulse} INBOUND PULSE: ${city.toUpperCase()}`)
					.setDescription(updateText)
					.setColor(config.COLORS.primary)
					.setThumbnail(interaction.guild.iconURL())
					.setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
					.setTimestamp()
                    .setFooter({ text: config.BRANDING.footerText });

				await pulseChannel.send({ embeds: [pulseEmbed] });
			}

			// 2. Update Notion
			const fork = await notion.findForkByCity(city);
			if (fork) {
				await notion.updatePulse(fork.id, new Date().toISOString());
				// Auto-complete Onboarding Step 5 (First pulse submitted)
				const onboardingStatus = await notion.getOnboardingStatus(fork.id).catch(() => null);
				if (onboardingStatus && !onboardingStatus.steps.find(s => s.step === 5)?.completed) {
					await notion.updateOnboardingStep(fork.id, 5, true).catch(() => {});
					console.log(`[PULSE] Automatically marked Onboarding Step 5 complete for ${city}.`);
				}
			}

			const successEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} PULSE SYNCHRONIZED`)
				.setDescription(`Your update for **${city}** has been broadcast to the network.`)
				.setColor(config.COLORS.success)
				.setTimestamp()
                .setFooter({ text: config.BRANDING.footerText });

			await interaction.editReply({ embeds: [successEmbed] });

		} catch (error) {
			console.error('[PULSE ERROR]', error);
			await interaction.editReply({ content: `❌ Protocol breach during pulse: ${error.message}` });
		}
	},
};
