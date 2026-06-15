const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
const auth = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('report-status')
		.setDescription('View report submission status')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Specific fork city (leave empty for all)')
				.setRequired(false)),

	async execute(interaction) {
		const flags = config.PRIVACY['report-status'] ? [MessageFlags.Ephemeral] : [];
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
							.setDescription('Your credentials do not grant access to view overall network report statuses. Please specify a city.')
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
						.setDescription(`Your credentials do not grant access to view report status for the **${city.toUpperCase()}** node.`)
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

				const reports = await notion.getReports(fork.id);
				const forkId = fork.id;

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} REPORT_STATUS // ${city.toUpperCase()}`)
					.setColor(config.COLORS.primary)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				if (reports.length === 0) {
					embed.addFields({
						name: '📊 REPORTS',
						value: 'No reports submitted yet.',
						inline: false,
					});
				} else {
					// Recent reports
					const recentReports = reports.slice(0, 5);
					const reportsText = recentReports.map(r => {
						const date = new Date(r.submittedDate).toLocaleDateString();
						const statusEmoji = r.status === 'on-time' ? '✅' : r.status === 'late' ? '⚠️' : '❌';
						return `${statusEmoji} **${r.type}** - ${date} (${r.status})`;
					}).join('\n');

					embed.addFields({
						name: '📋 RECENT_REPORTS',
						value: reportsText,
						inline: false,
					});

					// Stats
					const onTime = reports.filter(r => r.status === 'on-time').length;
					const late = reports.filter(r => r.status === 'late').length;
					const missing = reports.filter(r => r.status === 'missing').length;

					embed.addFields({
						name: '📊 STATISTICS',
						value: `Total: ${reports.length}\nOn-time: ${onTime}\nLate: ${late}\nMissing: ${missing}`,
						inline: false,
					});
				}

				// Current quarter requirements
				const now = new Date();
				const currentMonth = now.toLocaleString('default', { month: 'long' });
				embed.addFields({
					name: '📅 CURRENT_PERIOD',
					value: `Month: ${currentMonth}\nMonthly Report: Due end of month\nBi-weekly Report: Every 2 weeks`,
					inline: false,
				});

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

				const embed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.protocol} NETWORK_REPORT_STATUS`)
					.setColor(config.COLORS.primary)
					.setTimestamp()
					.setFooter({ text: config.BRANDING.footerText });

				let statusText = '';
				for (const fork of activeForks.slice(0, 10)) {
					const forkCity = (fork.properties['What city are you in?']?.rich_text?.[0]?.text?.content || 
					                  fork.properties['Fork Name']?.title?.[0]?.text?.content || 
					                  'UNKNOWN').toUpperCase();
					const reports = await notion.getReports(fork.id);
					const lastReport = reports[0];
					const lastReportDate = lastReport 
						? new Date(lastReport.submittedDate).toLocaleDateString()
						: 'Never';

					const statusEmoji = reports.length > 0 ? '✅' : '⚠️';
					statusText += `${statusEmoji} **${forkCity}**: ${reports.length} reports (Last: ${lastReportDate})\n`;
				}

				embed.addFields({
					name: '📊 FORK_REPORT_STATUS',
					value: statusText || 'No data available',
					inline: false,
				});

				await interaction.editReply({ embeds: [embed] });
			}

		} catch (error) {
			console.error('[REPORT_STATUS_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to retrieve report status.`,
			});
		}
	},
};