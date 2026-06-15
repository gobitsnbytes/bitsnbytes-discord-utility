const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const onboarding = require('../lib/onboarding');
const config = require('../config');
const auth = require('../lib/auth');

async function selfHealOnboarding(fork, guild) {
	const city = notion.getCityName(fork) || fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content;
	if (!city || !guild) return;
	
	const status = await notion.getOnboardingStatus(fork.id).catch(() => null);
	if (!status) return;
	
	const step2 = status.steps.find(s => s.step === 2);
	if (step2 && !step2.completed) {
		const normalizedCity = city.toLowerCase().replace(/\s+/g, '-');
		let channelExists = guild.channels.cache.some(c => c.name === city.toLowerCase() || c.name === normalizedCity);
		if (!channelExists) {
			try {
				const allChannels = await guild.channels.fetch();
				channelExists = allChannels.some(c => c.name === city.toLowerCase() || c.name === normalizedCity);
			} catch (err) {
				console.warn('[ONBOARDING] Fallback channel fetch failed:', err.message);
			}
		}
		if (channelExists) {
			await notion.updateOnboardingStep(fork.id, 2, true).catch(() => {});
			console.log(`[ONBOARDING SELF-HEAL] Step 2 complete for ${city}`);
		}
	}
	
	const step5 = status.steps.find(s => s.step === 5);
	if (step5 && !step5.completed) {
		const lastPulse = fork.properties['Last Pulse']?.date?.start;
		if (lastPulse) {
			await notion.updateOnboardingStep(fork.id, 5, true).catch(() => {});
			console.log(`[ONBOARDING SELF-HEAL] Step 5 complete for ${city}`);
		}
	}
	
	const step6 = status.steps.find(s => s.step === 6);
	if (step6 && !step6.completed) {
		const teamMembers = await notion.getTeamMembers(fork.id).catch(() => []);
		const teamValidator = require('../lib/teamValidator');
		const validation = teamValidator.validateTeam(teamMembers);
		if (validation.missingRoles.length === 0) {
			await notion.updateOnboardingStep(fork.id, 6, true).catch(() => {});
			console.log(`[ONBOARDING SELF-HEAL] Step 6 complete for ${city}`);
		}
	}
	
	const step7 = status.steps.find(s => s.step === 7);
	if (step7 && !step7.completed) {
		const eventsList = await notion.getEvents(fork.id).catch(() => []);
		if (eventsList.length > 0) {
			await notion.updateOnboardingStep(fork.id, 7, true).catch(() => {});
			console.log(`[ONBOARDING SELF-HEAL] Step 7 complete for ${city}`);
		}
	}
}

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
			let city = interaction.options.getString('city');
			const member = interaction.member;
			const isGlobal = auth.isExecutiveLeader(member) || auth.isDepartmentLead(member) || auth.isParentTrackContributor(member);

			if (!city) {
				if (isGlobal) {
					// Fall through to all forks
				} else {
					const userCity = auth.getMemberCity(member);
					if (userCity) {
						city = userCity;
					} else {
						const unauthorizedEmbed = new EmbedBuilder()
							.setTitle(`❌ PROTOCOL_UNAUTHORIZED`)
							.setDescription('Your credentials do not grant access to view overall pending onboardings. Please specify a city.')
							.setColor(config.COLORS.error)
							.setFooter({ text: config.BRANDING.footerText });
						return await interaction.editReply({ embeds: [unauthorizedEmbed] });
					}
				}
			}

			if (city) {
				const isAuthorized = await auth.isAuthorizedForCity(interaction.user, city, interaction.guild, 'view');
				if (!isAuthorized) {
					const unauthorizedEmbed = new EmbedBuilder()
						.setTitle(`❌ PROTOCOL_UNAUTHORIZED`)
						.setDescription(`Your credentials do not grant access to view onboarding status for the **${city.toUpperCase()}** node.`)
						.setColor(config.COLORS.error)
						.setFooter({ text: config.BRANDING.footerText });
					return await interaction.editReply({ embeds: [unauthorizedEmbed] });
				}

				const fork = await notion.findForkByCity(city);
				if (!fork) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} Fork not found: ${city}`,
					});
				}

				// Run self-healing before displaying
				await selfHealOnboarding(fork, interaction.guild);

				const onboardingStatus = await notion.getOnboardingStatus(fork.id);
				const statusLabel = onboarding.getOnboardingStatusLabel(onboardingStatus);

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} ONBOARDING_STATUS // ${city.toUpperCase()}`)
					.setColor(statusLabel.color)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				const progressBar = onboarding.getProgressBar(onboardingStatus.progress);
				embed.addFields({
					name: `📊 PROGRESS: ${onboardingStatus.progress}/${onboardingStatus.total} (${onboarding.getCompletionPercentage(onboardingStatus)}%)`,
					value: `\`${progressBar}\` ${statusLabel.emoji} ${statusLabel.label}`,
					inline: false,
				});

				const stepsDisplay = onboarding.formatOnboardingProgress(onboardingStatus);
				embed.addFields({
					name: '📋 ONBOARDING_CHECKLIST',
					value: stepsDisplay,
					inline: false,
				});

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
				// All forks view
				const forks = await notion.getForks();
				const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

				if (activeForks.length === 0) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} No active forks found.`,
					});
				}

				// Run self-healing for all active forks in parallel
				const healTasks = activeForks.map(fork => () => selfHealOnboarding(fork, interaction.guild));
				await notion.limitConcurrency(healTasks, 3);

				const forkStatuses = [];
				const tasks = activeForks.map(fork => async () => {
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
				});
				await notion.limitConcurrency(tasks, 3);

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

				const resolvedMembers = await Promise.all(
					forkStatuses.map(async f => {
						if (!f.leadId) return null;
						try {
							return await interaction.guild.members.fetch(f.leadId);
						} catch {
							return null;
						}
					})
				);

				const statusText = forkStatuses.map((f, index) => {
					const label = onboarding.getOnboardingStatusLabel(f.status);
					let mention;
					if (f.leadId) {
						const member = resolvedMembers[index];
						const displayName = member ? member.displayName : null;
						mention = displayName ? `${displayName} (<@${f.leadId}>)` : `<@${f.leadId}>`;
					} else {
						mention = 'No lead';
					}
					return `${label.emoji} **${f.city.toUpperCase()}**: ${f.status.progress}/7 (${label.label}) — ${mention}`;
				}).join('\n');

				embed.addFields({
					name: '📊 FORK_ONBOARDING_STATUS',
					value: statusText,
					inline: false,
				});

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