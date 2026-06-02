const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const gamification = require('../lib/gamification');
const healthScore = require('../lib/healthScore');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('leaderboard')
		.setDescription('View points leaderboard')
		.addStringOption(option =>
			option
				.setName('period')
				.setDescription('Time period')
				.setRequired(false)
				.addChoices(
					{ name: 'This Month', value: 'month' },
					{ name: 'All Time', value: 'all' },
				)),

	async execute(interaction) {
		const flags = config.PRIVACY['leaderboard'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const period = interaction.options.getString('period') || 'month';

			const forks = await notion.getForks();
			const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');

			if (activeForks.length === 0) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} No active forks found.`,
				});
			}

			// Calculate points for each fork
			const forkPoints = [];
			for (const fork of activeForks) {
				const city = fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
				             fork.properties['Fork Name']?.title?.[0]?.text?.content || 
				             'UNKNOWN';
				const leadId = fork.properties['Discord ID']?.rich_text?.[0]?.text?.content;
				const health = healthScore.calculateHealthScore(fork);

				// Get stored points - use persisted Monthly Points as single source of truth
				const storedPoints = fork.properties.Points?.number || 0;
				const persistedMonthlyPoints = fork.properties['Monthly Points']?.number || 0;

				// Use the persisted monthly points which includes all point sources
				// (reports, events, onboarding, team, pulse, partnership, health)
				const monthlyPoints = persistedMonthlyPoints;
				const totalPoints = storedPoints;
				const level = gamification.getLevelFromPoints(totalPoints);

				forkPoints.push({
					city,
					leadId,
					monthlyPoints,
					totalPoints,
					level,
					healthScore: health.score,
				});
			}

			// Sort by appropriate points
			if (period === 'month') {
				forkPoints.sort((a, b) => b.monthlyPoints - a.monthlyPoints);
			} else {
				forkPoints.sort((a, b) => b.totalPoints - a.totalPoints);
			}

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} POINTS_LEADERBOARD // ${period === 'month' ? 'THIS_MONTH' : 'ALL_TIME'}`)
				.setColor(config.COLORS.primary)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			// Top 10
			const topForks = forkPoints.slice(0, 10);
			const leaderboardText = topForks.map((f, i) => {
				const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
				const points = period === 'month' ? f.monthlyPoints : f.totalPoints;
				const mention = f.leadId ? `<@${f.leadId}>` : 'No lead';
				return `${medal} **${f.city.toUpperCase()}** — ${points} pts\n` +
					`   Level ${f.level.level} (${f.level.name}) | Health: ${f.healthScore}/100`;
			}).join('\n\n');

			embed.addFields({
				name: '🏆 RANKINGS',
				value: leaderboardText,
				inline: false,
			});

			// Stats
			const totalNetworkPoints = forkPoints.reduce((sum, f) => sum + f.totalPoints, 0);
			const avgHealth = Math.round(forkPoints.reduce((sum, f) => sum + f.healthScore, 0) / forkPoints.length);

			embed.addFields({
				name: '📊 NETWORK_STATS',
				value: `Total Points: ${totalNetworkPoints}\nActive Forks: ${forkPoints.length}\nAvg Health: ${avgHealth}/100`,
				inline: false,
			});

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[LEADERBOARD_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to retrieve leaderboard.`,
			});
		}
	},
};