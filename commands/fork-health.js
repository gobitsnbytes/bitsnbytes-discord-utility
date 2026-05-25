const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const healthScore = require('../lib/healthScore');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('fork-health')
		.setDescription('Display fork health leaderboard')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('View specific fork health')
				.setRequired(false))
		.addStringOption(option =>
			option
				.setName('period')
				.setDescription('Time period for the leaderboard')
				.setRequired(false)
				.addChoices(
					{ name: 'Week', value: 'week' },
					{ name: 'Month', value: 'month' },
					{ name: 'All Time', value: 'all-time' },
				)),

	async execute(interaction) {
		const flags = config.PRIVACY['fork-health'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const city = interaction.options.getString('city');
			const period = interaction.options.getString('period') || 'all-time';

			// If specific city requested
			if (city) {
				const fork = await notion.findForkByCity(city);
				if (!fork) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} Fork not found: ${city}`,
					});
				}

				const health = healthScore.calculateHealthScore(fork);
				const status = healthScore.getHealthStatus(health.score);

				const embed = new EmbedBuilder()
					.setTitle(`${status.emoji} HEALTH_REPORT // ${city.toUpperCase()}`)
					.setColor(status.color)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				// Score display
				embed.addFields({
					name: '📊 OVERALL_SCORE',
					value: `**${health.score}/100** (${status.label})`,
					inline: false,
				});

				// Breakdown
				const breakdownText = [
					`⚡ **Pulse Recency**: ${health.breakdown.pulseRecency}/25`,
					`📅 **Events Conducted**: ${health.breakdown.eventsConducted}/25`,
					`👥 **Team Completeness**: ${health.breakdown.teamCompleteness}/20`,
					`📝 **Report Submission**: ${health.breakdown.reportSubmission}/15`,
					`🤝 **Partnerships**: ${health.breakdown.partnerships}/15`,
				].join('\n');

				embed.addFields({
					name: '📈 SCORE_BREAKDOWN',
					value: breakdownText,
					inline: false,
				});

				// Progress bar
				const filled = Math.round(health.score / 5);
				const empty = 20 - filled;
				const progressBar = '█'.repeat(filled) + '░'.repeat(empty);
				embed.addFields({
					name: '📉 HEALTH_BAR',
					value: `\`${progressBar}\``,
					inline: false,
				});

				return await interaction.editReply({ embeds: [embed] });
			}

			// Otherwise show leaderboard
			const forks = await notion.getForks();
			const rankedForks = healthScore.rankForksByHealth(forks);

			if (rankedForks.length === 0) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} No active forks found.`,
				});
			}

			const embed = new EmbedBuilder()
				.setTitle(`🏆 HEALTH_LEADERBOARD // ${period.toUpperCase()}`)
				.setColor(config.COLORS.primary)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			// Top 10 forks
			const leaderboardText = rankedForks.slice(0, 10).map((f, i) => {
				const city = (f.fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
				              f.fork.properties['Fork Name']?.title?.[0]?.text?.content || 
				              'UNKNOWN').toUpperCase();
				const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
				return `${medal} **${city}** — ${f.healthStatus.emoji} ${f.healthScore}/100`;
			}).join('\n');

			embed.addFields({
				name: '📊 RANKINGS',
				value: leaderboardText,
				inline: false,
			});

			// At-risk forks
			const atRisk = healthScore.getAtRiskForks(rankedForks);
			if (atRisk.length > 0) {
				const atRiskText = atRisk.slice(0, 5).map(f => {
					const city = (f.fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 'UNKNOWN').toUpperCase();
					return `⚠️ ${city} (${f.healthScore}/100)`;
				}).join('\n');

				embed.addFields({
					name: '🚨 AT_RISK_FORKS',
					value: atRiskText,
					inline: false,
				});
			}

			// Stats
			const avgScore = Math.round(rankedForks.reduce((sum, f) => sum + f.healthScore, 0) / rankedForks.length);
			embed.addFields({
				name: '📈 NETWORK_STATS',
				value: `Total Forks: ${rankedForks.length}\nAvg Health: ${avgScore}/100\nAt Risk: ${atRisk.length}`,
				inline: false,
			});

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[FORK_HEALTH_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to retrieve health data.`,
			});
		}
	},
};