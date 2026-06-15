const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const events = require('../lib/events');
const config = require('../config');
const auth = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('event-status')
		.setDescription('View event pipeline')
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Filter by fork city')
				.setRequired(false))
		.addStringOption(option =>
			option
				.setName('status')
				.setDescription('Filter by status')
				.setRequired(false)
				.addChoices(
					{ name: '💡 Idea', value: 'Idea' },
					{ name: '📋 Planned', value: 'Planned' },
					{ name: '✅ Approved', value: 'Approved' },
					{ name: '🚀 Executing', value: 'Executing' },
					{ name: '🎉 Completed', value: 'Completed' },
				)),

	async execute(interaction) {
		const flags = config.PRIVACY['event-status'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			let city = interaction.options.getString('city');
			const status = interaction.options.getString('status');

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
							.setDescription('Your credentials do not grant access to view overall network event pipelines. Please specify a city.')
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
						.setDescription(`Your credentials do not grant access to view event pipeline for the **${city.toUpperCase()}** node.`)
						.setColor(config.COLORS.error)
						.setFooter({ text: config.BRANDING.footerText });
					return await interaction.editReply({ embeds: [unauthorizedEmbed] });
				}
			}

			let forkId = null;
			let forkCity = '';

			if (city) {
				const fork = await notion.findForkByCity(city);
				if (!fork) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} Fork not found: ${city}`,
					});
				}
				forkId = fork.id;
				forkCity = city;
			}

			// Get events
			const eventList = await notion.getEvents(forkId, status);

			if (eventList.length === 0) {
				return await interaction.editReply({
					content: `${config.EMOJIS.warning} No events found${city ? ` for ${city}` : ''}${status ? ` with status "${status}"` : ''}.`,
				});
			}

			// Add fork city to events for display
			if (forkCity) {
				eventList.forEach(e => e.forkCity = forkCity);
			}

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} EVENT_PIPELINE${city ? ` // ${city.toUpperCase()}` : ''}`)
				.setColor(config.COLORS.primary)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			// Group by status
			const eventsByStatus = events.formatEventsList(eventList, 'status');
			embed.addFields({
				name: '📊 EVENTS',
				value: eventsByStatus.substring(0, 1000),
				inline: false,
			});

			// Stats
			const stats = events.getEventStats(eventList);
			embed.addFields({
				name: '📈 STATISTICS',
				value: `Total: ${stats.total}\nUpcoming: ${stats.upcoming}\nCompleted: ${stats.completed}`,
				inline: false,
			});

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[EVENT_STATUS_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to retrieve events.`,
			});
		}
	},
};