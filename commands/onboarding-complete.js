const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const onboarding = require('../lib/onboarding');
const config = require('../config');
const logger = require('../lib/logger');

// Staff role ID for permission check
const STAFF_ROLE_ID = '1490410540361580554';

module.exports = {
	data: new SlashCommandBuilder()
		.setName('onboarding-complete')
		.setDescription('Staff command: Mark onboarding step complete')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(true))
		.addIntegerOption(option =>
			option
				.setName('step')
				.setDescription('Step number (1-7)')
				.setRequired(true)
				.setMinValue(1)
				.setMaxValue(7)),

	async execute(interaction) {
		// Staff permission check
		const member = await interaction.guild.members.fetch(interaction.user.id);
		if (!member.roles.cache.has(STAFF_ROLE_ID)) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
				.setDescription('Your credentials do not grant access to this command.')
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			return await interaction.reply({
				embeds: [unauthorizedEmbed],
				flags: [MessageFlags.Ephemeral],
			});
		}

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			const city = interaction.options.getString('city');
			const step = interaction.options.getInteger('step');

			// Find the fork
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Fork not found: ${city}`,
				});
			}

			// Get step info
			const stepInfo = onboarding.getStepInfo(step);
			if (!stepInfo) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Invalid step number: ${step}`,
				});
			}

			// Get pre-update onboarding status to detect transition
			const preStatus = await notion.getOnboardingStatus(fork.id);
			const wasComplete = onboarding.isOnboardingComplete(preStatus);

			// Update the onboarding step
			await notion.updateOnboardingStep(fork.id, step, true);

			// Get updated status
			const onboardingStatus = await notion.getOnboardingStatus(fork.id);
			const statusLabel = onboarding.getOnboardingStatusLabel(onboardingStatus);
			const isNowComplete = onboarding.isOnboardingComplete(onboardingStatus);

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} ONBOARDING_UPDATE // ${city.toUpperCase()}`)
				.setColor(config.COLORS.success)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			embed.addFields({
				name: '✅ STEP_COMPLETED',
				value: `**Step ${step}**: ${stepInfo.label}`,
				inline: false,
			});

			embed.addFields({
				name: '📊 OVERALL_PROGRESS',
				value: `${onboardingStatus.progress}/${onboardingStatus.total} (${onboarding.getCompletionPercentage(onboardingStatus)}%) — ${statusLabel.emoji} ${statusLabel.label}`,
				inline: false,
			});

			// Show remaining steps if any
			if (!isNowComplete) {
				const nextStep = onboarding.getNextPendingStep(onboardingStatus);
				if (nextStep) {
					embed.addFields({
						name: '🎯 NEXT_PENDING',
						value: `Step ${nextStep.step}: ${nextStep.label}`,
						inline: false,
					});
				}
			} else {
				embed.addFields({
					name: '🎉 ONBOARDING_COMPLETE',
					value: 'All steps have been completed! The fork is now fully onboarded.',
					inline: false,
				});

				// Award points only if this is a transition from incomplete to complete
				if (!wasComplete && isNowComplete) {
					try {
						await notion.updateForkPoints(fork.id, 20);
						embed.addFields({
							name: '🏆 BONUS',
							value: '+20 points awarded for completing onboarding!',
							inline: false,
						});
					} catch (e) {
						// Points might not be set up, ignore
					}
				}
			}

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			// Let the global interaction handler log the error, but we'll provide a friendly response first
			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({
					content: `${config.EMOJIS.error} SYSTEM_FAILURE: ${error.message || 'Unable to update onboarding step.'}`,
				}).catch(() => {});
			}
			throw error;
		}
	},
};