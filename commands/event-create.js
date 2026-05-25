const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const events = require('../lib/events');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('event-create')
		.setDescription('Create a new event proposal')
		.addStringOption(option =>
			option
				.setName('title')
				.setDescription('Event name')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('city')
				.setDescription('Fork city')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('date')
				.setDescription('Event date (YYYY-MM-DD)')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('type')
				.setDescription('Event type')
				.setRequired(true)
				.addChoices(
					{ name: '🛠️ Workshop', value: 'workshop' },
					{ name: '💻 Hackathon', value: 'hackathon' },
					{ name: '👥 Meetup', value: 'meetup' },
					{ name: '📌 Other', value: 'other' },
				))
		.addStringOption(option =>
			option
				.setName('description')
				.setDescription('Event details')
				.setRequired(true))
		.addIntegerOption(option =>
			option
				.setName('expected-attendees')
				.setDescription('Expected headcount')
				.setRequired(false)
				.setMinValue(1)),

	async execute(interaction) {
		const flags = config.PRIVACY['event-create'] ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const title = interaction.options.getString('title');
			const city = interaction.options.getString('city');
			const dateStr = interaction.options.getString('date');
			const type = interaction.options.getString('type');
			const description = interaction.options.getString('description') || '';
			const expectedAttendees = interaction.options.getInteger('expected-attendees') || 0;

			// Enforce authorization check
			const auth = require('../lib/auth');
			const isAuthorized = await auth.isAuthorizedForCity(interaction.user, city, interaction.guild);
			if (!isAuthorized) {
				const unauthorizedEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
					.setDescription(`Your credentials do not grant access to create event proposals for the **${city.toUpperCase()}** node.`)
					.setColor(config.COLORS.error)
					.setFooter({ text: config.BRANDING.footerText });
				return await interaction.editReply({ embeds: [unauthorizedEmbed] });
			}

			// Validate date format
			const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
			if (!dateRegex.test(dateStr)) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Invalid date format. Please use YYYY-MM-DD (e.g., 2024-05-15).`,
				});
			}

			// Find the fork
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Fork not found: ${city}`,
				});
			}

			// Create the event
			const event = await notion.createEvent({
				title,
				forkId: fork.id,
				date: dateStr,
				type,
				description,
				expectedAttendees,
				createdBy: interaction.user.id,
			});

			// Push to Cal.com -> Google Calendar for visibility
			let calcomBookingId = null;
			if (process.env.CALCOM_API_KEY && process.env.CALCOM_EVENT_TYPE_30) {
				try {
					const calcom = require('../lib/calcom');
					const bookingResponse = await calcom.createBooking({
						eventTypeId: parseInt(process.env.CALCOM_EVENT_TYPE_30, 10),
						start: new Date(`${dateStr}T10:00:00+05:30`).toISOString(),
						timeZone: 'Asia/Kolkata',
						language: 'en',
						metadata: { discord_event_id: event?.id || 'unknown', fork_city: city },
						attendee: {
							name: interaction.user.username,
							email: process.env.SMTP_USER || 'hello@gobitsnbytes.org',
							timeZone: 'Asia/Kolkata'
						},
						bookingFieldsResponses: {
							notes: `Fork Event: ${title}\nCity: ${city}\nType: ${type}\n\n${description}`.trim()
						}
					});
					if (bookingResponse && (bookingResponse.uid || bookingResponse.id)) {
						calcomBookingId = String(bookingResponse.uid || bookingResponse.id);
						console.log(`[EVENT_CREATE] Cal.com booking created: ${calcomBookingId} for ${city} fork event`);
					}
				} catch (calErr) {
					console.warn('[EVENT_CREATE] Cal.com sync failed (non-fatal):', calErr.message);
				}
			}

			// Award points for creating event
			try {
				await notion.updateForkPoints(fork.id, 2);
			} catch (e) {
				// Points might not be set up, ignore
			}

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} EVENT_CREATED // ${title.toUpperCase()}`)
				.setColor(config.COLORS.success)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			const typeEmoji = events.getTypeEmoji(type);
			embed.addFields({
				name: '✅ EVENT_DETAILS',
				value: `${typeEmoji} **Type**: ${type.charAt(0).toUpperCase() + type.slice(1)}\n` +
					`📍 **Fork**: ${city.toUpperCase()}\n` +
					`📅 **Date**: ${dateStr}\n` +
					`💡 **Status**: Idea\n` +
					`👥 **Expected**: ${expectedAttendees || 'TBD'}`,
				inline: false,
			});

			if (description) {
				embed.addFields({
					name: '📝 DESCRIPTION',
					value: description.substring(0, 1000),
					inline: false,
				});
			}

			embed.addFields({
				name: '📋 NEXT_STEPS',
				value: 'Use `/event-update` to advance the event through stages:\n' +
					'Idea → Planned → Approved → Executing → Completed',
				inline: false,
			});

			embed.addFields({
				name: '🏆 POINTS',
				value: '+2 points awarded for creating an event!',
				inline: false,
			});

			if (calcomBookingId) {
				embed.addFields({
					name: '📆 GOOGLE CALENDAR',
					value: 'Synced → will appear on the BnB central calendar',
					inline: false,
				});
			}

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[EVENT_CREATE_ERROR]', error);
			
			if (error.message.includes('NOTION_EVENTS_DB not configured')) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Events database not configured. Please set NOTION_EVENTS_DB in environment.`,
				});
			}

			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to create event.`,
			});
		}
	},
};