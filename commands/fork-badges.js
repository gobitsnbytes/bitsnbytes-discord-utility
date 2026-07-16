const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const gamification = require('../lib/gamification');
const healthScore = require('../lib/healthScore');
const teamValidator = require('../lib/teamValidator');
const config = require('../config');
const auth = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('fork-badges')
		.setDescription('View fork badges and achievements')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(false)),

	async execute(interaction) {
		const flags = config.PRIVACY['fork-badges'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			let city = interaction.options.getString('city');
			const member = interaction.member;
			const isGlobal = auth.isExecutiveLeader(member) || auth.isDepartmentLead(member) || auth.isParentTrackContributor(member);

			if (!city) {
				if (isGlobal) {
					// Fall through to all forks overview
				} else {
					const userCity = auth.getMemberCity(member);
					if (userCity) {
						city = userCity;
					} else {
						const unauthorizedEmbed = new EmbedBuilder()
							.setTitle(`❌ PROTOCOL_UNAUTHORIZED`)
							.setDescription('Your credentials do not grant access to view overall network badges. Please specify a city.')
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
						.setDescription(`Your credentials do not grant access to view badges for the **${city.toUpperCase()}** node.`)
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

				// Gather data for badge calculation
				const health = healthScore.calculateHealthScore(fork);
				const teamMembers = await notion.getTeamMembers(fork.id);
				const teamValidation = teamValidator.validateTeam(teamMembers);
				const events = await notion.getEvents(fork.id);
				const reports = await notion.getReports(fork.id);
				const onboardingStatus = await notion.getOnboardingStatus(fork.id);

				// Build fork data for badge calculation
				const activeMonths = new Set();
				reports.forEach(r => {
					if (r.submittedDate) {
						const d = new Date(r.submittedDate);
						activeMonths.add(`${d.getFullYear()}-${d.getMonth()}`);
					}
				});
				events.filter(e => e.status === 'Completed').forEach(e => {
					if (e.date) {
						const d = new Date(e.date);
						activeMonths.add(`${d.getFullYear()}-${d.getMonth()}`);
					}
				});
				
				let activeMonthsStreak = 0;
				const now = new Date();
				for (let i = 0; i < 12; i++) {
					const checkDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
					const key = `${checkDate.getFullYear()}-${checkDate.getMonth()}`;
					if (activeMonths.has(key)) {
						activeMonthsStreak++;
					} else if (i > 0) {
						break;
					}
				}

				// Calculate pulse streak from the fork's Notion Last Pulse property
				let pulseStreak = 0;
				const lastPulseDate = fork.properties['Last Pulse']?.date?.start;
				if (lastPulseDate) {
					const diffDays = Math.floor((new Date() - new Date(lastPulseDate)) / (1000 * 60 * 60 * 24));
					// Approximate weekly pulses: each 7-day window is one "streak" unit
					// Use reports as additional pulse signals for a combined streak estimate
					if (diffDays < 7) pulseStreak = Math.max(1, reports.length);
					else if (diffDays < 14) pulseStreak = Math.max(1, Math.ceil(reports.length * 0.75));
					else if (diffDays < 30) pulseStreak = Math.ceil(reports.length * 0.5);
				}

				const forkData = {
					health,
					totalEvents: events.filter(e => e.status === 'Completed').length,
					teamComplete: teamValidation.isValid,
					teamMembersAdded: teamMembers.length,
					pulseStreak,
					reportsOnTime: reports.filter(r => r.status === 'on-time').length,
					partnerships: fork.properties['Partnerships Count']?.number || 0,
					onboardingComplete: onboardingStatus.progress === 7,
					maxEventAttendance: Math.max(...events.map(e => e.actualAttendees || 0), 0),
					activeMonthsStreak,
				};

				const earnedBadges = gamification.determineBadges(forkData);
				const storedBadges = await notion.getForkBadges(fork.id);
				const storedPoints = fork.properties.Points?.number || 0;
				const level = gamification.getLevelFromPoints(storedPoints);
				const progress = gamification.getProgressToNextLevel(storedPoints);

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} FORK_ACHIEVEMENTS // ${city.toUpperCase()}`)
					.setColor(level.color)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				embed.addFields({
					name: `⭐ LEVEL ${level.level}: ${level.name.toUpperCase()}`,
					value: `${storedPoints} total points\n${progress.pointsNeeded > 0 ? `${progress.pointsNeeded} pts to next level` : 'Max level reached!'}`,
					inline: false,
				});

				const progressBar = '█'.repeat(Math.floor(progress.progress / 10)) + '░'.repeat(10 - Math.floor(progress.progress / 10));
				embed.addFields({
					name: '📈 PROGRESS',
					value: `\`${progressBar}\` ${progress.progress}%`,
					inline: false,
				});

				if (earnedBadges.length > 0) {
					const badgesText = earnedBadges.map(gamification.formatBadge).join('\n');
					embed.addFields({
						name: `🏅 BADGES (${earnedBadges.length})`,
						value: badgesText.substring(0, 1000),
						inline: false,
					});
				} else {
					embed.addFields({
						name: '🏅 BADGES',
						value: 'No badges earned yet. Keep up the great work!',
						inline: false,
					});
				}

				const nextBadges = [];
				if (forkData.totalEvents === 0) {
					nextBadges.push('🎯 Host your first event to earn "First Steps"');
				}
				if (!forkData.teamComplete) {
					nextBadges.push('👥 Complete your team structure to earn "Team Builder"');
				}
				if (forkData.partnerships === 0) {
					nextBadges.push('🤝 Secure your first partnership to earn "Partner Up"');
				}
				if (!forkData.onboardingComplete) {
					nextBadges.push('✅ Complete onboarding to earn "Fully Onboarded"');
				}
				if (health.score < 60) {
					nextBadges.push('💚 Improve health to 60+ to earn "Healthy Fork"');
				}

				if (nextBadges.length > 0) {
					embed.addFields({
						name: '🎯 NEXT_ACHIEVEMENTS',
						value: nextBadges.slice(0, 5).join('\n'),
						inline: false,
					});
				}

				return await interaction.editReply({ embeds: [embed] });
			} else {
				// All forks overview
				const forks = await notion.getForks();
				const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

				if (activeForks.length === 0) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} No active forks found.`,
					});
				}

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} NETWORK_BADGES_OVERVIEW`)
					.setColor(config.COLORS.primary)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				const badgeRows = [];
				for (const fork of activeForks) {
					const cityName = notion.getCityName(fork) || 'UNKNOWN';
					const badges = await notion.getForkBadges(fork.id).catch(() => []);
					badgeRows.push(`**${cityName.toUpperCase()}**: ${badges.length > 0 ? badges.join(' ') : 'No badges yet'}`);
				}

				embed.addFields({
					name: '🏆 FORK BADGES',
					value: badgeRows.join('\n').substring(0, 1000) || 'None',
					inline: false,
				});

				await interaction.editReply({ embeds: [embed] });
			}

		} catch (error) {
			console.error('[FORK_BADGES_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to retrieve badges.`,
			});
		}
	},
};