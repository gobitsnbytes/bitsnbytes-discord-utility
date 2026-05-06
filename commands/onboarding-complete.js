const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const onboarding = require('../lib/onboarding');
const config = require('../config');

// Staff role ID for permission check
const STAFF_ROLE_ID = '1490410540361580554';

module.exports = {
	data: new SlashCommandBuilder()
		.setName('onboarding-complete')
		.setDescription('Staff command: Mark onboarding step(s) complete')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('steps')
				.setDescription('Steps to mark complete (e.g., "3" for single, "1-3" for range, "1,3,5" for multiple, "1-3,5-7" for combination)')
				.setRequired(true)),

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
			const stepsInput = interaction.options.getString('steps');

			// Parse the steps input
			const parseResult = onboarding.parseStepsInput(stepsInput);
			if (parseResult.error) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Invalid steps input: ${parseResult.error}`,
				});
			}

			const stepsToComplete = parseResult.steps;
			if (stepsToComplete.length === 0) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} No valid steps provided.`,
				});
			}

			// Find the fork
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Fork not found: ${city}`,
				});
			}

			// Get pre-update onboarding status to detect transition
			const preStatus = await notion.getOnboardingStatus(fork.id);
			const wasComplete = onboarding.isOnboardingComplete(preStatus);

			// Track completed steps for response
			const completedSteps = [];
			const alreadyCompleteSteps = [];

			// Update each onboarding step
			for (const step of stepsToComplete) {
				const stepInfo = onboarding.getStepInfo(step);
				
				// Check if step was already complete
				const stepStatus = preStatus.steps.find(s => s.step === step);
				if (stepStatus && stepStatus.completed) {
					alreadyCompleteSteps.push({ step, label: stepInfo?.label || 'Unknown' });
				} else {
					await notion.updateOnboardingStep(fork.id, step, true);
					completedSteps.push({ step, label: stepInfo?.label || 'Unknown' });
				}
			}

			// Get updated status
			const onboardingStatus = await notion.getOnboardingStatus(fork.id);
			const statusLabel = onboarding.getOnboardingStatusLabel(onboardingStatus);
			const isNowComplete = onboarding.isOnboardingComplete(onboardingStatus);

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} ONBOARDING_UPDATE // ${city.toUpperCase()}`)
				.setColor(config.COLORS.success)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			// Show completed steps
			if (completedSteps.length > 0) {
				const stepsDisplay = completedSteps.map(s => `**Step ${s.step}**: ${s.label}`).join('\n');
				embed.addFields({
					name: `✅ STEPS_COMPLETED (${completedSteps.length})`,
					value: stepsDisplay,
					inline: false,
				});
			}

			// Show already complete steps (if any)
			if (alreadyCompleteSteps.length > 0) {
				const alreadyDisplay = alreadyCompleteSteps.map(s => `Step ${s.step}: ${s.label}`).join(', ');
				embed.addFields({
					name: 'ℹ️ ALREADY_COMPLETE',
					value: alreadyDisplay,
					inline: false,
				});
			}

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
			console.error('[ONBOARDING_COMPLETE_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to update onboarding step(s).`,
			});
		}
	},
};