const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const onboarding = require('../lib/onboarding');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('onboarding-status')
		.setDescription('View onboarding progress')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Specific fork city (leave empty for all pending)')
				.setRequired(false)),

	async execute(interaction) {
		const flags = config.PRIVACY['onboarding-status'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const city = interaction.options.getString('city');

			// Single fork view
			if (city) {
				const fork = await notion.findForkByCity(city);
				if (!fork) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} Fork not found: ${city}`,
					});
				}

				const onboardingStatus = await notion.getOnboardingStatus(fork.id);
				const statusLabel = onboarding.getOnboardingStatusLabel(onboardingStatus);

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} ONBOARDING_STATUS // ${city.toUpperCase()}`)
					.setColor(statusLabel.color)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				// Progress overview
				const progressBar = onboarding.getProgressBar(onboardingStatus.progress);
				embed.addFields({
					name: `📊 PROGRESS: ${onboardingStatus.progress}/${onboardingStatus.total} (${onboarding.getCompletionPercentage(onboardingStatus)}%)`,
					value: `\`${progressBar}\` ${statusLabel.emoji} ${statusLabel.label}`,
					inline: false,
				});

				// Steps checklist
				const stepsDisplay = onboarding.formatOnboardingProgress(onboardingStatus);
				embed.addFields({
					name: '📋 ONBOARDING_CHECKLIST',
					value: stepsDisplay,
					inline: false,
				});

				// Next step if incomplete
				if (!onboarding.isOnboardingComplete(onboardingStatus)) {
					const nextStep = onboarding.getNextPendingStep(onboardingStatus);
					if (nextStep) {
						embed.addFields({
							name: '🎯 NEXT_STEP',
							value: `**Step ${nextStep.step}**: ${nextStep.label}\n${nextStep.description}`,
							inline: false,
						});
					}
				} else {
					embed.addFields({
						name: '🎉 COMPLETE',
						value: 'All onboarding steps have been completed!',
						inline: false,
					});
				}

				await interaction.editReply({ embeds: [embed] });
			} else {
				// All forks view - show pending onboardings
				const forks = await notion.getForks();
				const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

				const forkStatuses = [];
				for (const fork of activeForks) {
					const status = await notion.getOnboardingStatus(fork.id);
					if (!onboarding.isOnboardingComplete(status)) {
						const city = fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
						             fork.properties['Fork Name']?.title?.[0]?.text?.content || 
						             'UNKNOWN';
						forkStatuses.push({
							city,
							status,
							leadId: fork.properties['Discord ID']?.rich_text?.[0]?.text?.content,
						});
					}
				}

				if (forkStatuses.length === 0) {
					return await interaction.editReply({
						content: `${config.EMOJIS.active} All active forks have completed onboarding!`,
					});
				}

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} PENDING_ONBOARDINGS`)
					.setColor(config.COLORS.primary)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				const statusText = forkStatuses.map(f => {
					const label = onboarding.getOnboardingStatusLabel(f.status);
					const mention = f.leadId ? `<@${f.leadId}>` : 'No lead';
					return `${label.emoji} **${f.city.toUpperCase()}**: ${f.status.progress}/7 (${label.label}) — ${mention}`;
				}).join('\n');

				embed.addFields({
					name: '📊 FORK_ONBOARDING_STATUS',
					value: statusText,
					inline: false,
				});

				// Summary stats
				const totalPending = forkStatuses.length;
				const avgProgress = Math.round(
					forkStatuses.reduce((sum, f) => sum + f.status.progress, 0) / totalPending
				);
				embed.addFields({
					name: '📈 SUMMARY',
					value: `Pending: ${totalPending} forks\nAvg Progress: ${avgProgress}/7 steps`,
					inline: false,
				});

				await interaction.editReply({ embeds: [embed] });
			}

		} catch (error) {
			console.error('[ONBOARDING_STATUS_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to retrieve onboarding status.`,
			});
		}
	},
};