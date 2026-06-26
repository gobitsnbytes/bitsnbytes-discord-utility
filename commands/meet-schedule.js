const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');
const { createMeetingVoiceChannel, sendMeetingDMs, sendMeetingEmails } = require('../lib/meetingsHelper');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('meet-schedule')
		.setDescription('Schedule a new meeting.')
		.addStringOption(option => 
			option.setName('title')
				.setDescription('The title/subject of the meeting')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('location-type')
				.setDescription('Where the meeting will take place')
				.setRequired(true)
				.addChoices(
					{ name: 'Discord Voice Channel', value: 'discord_vc' },
					{ name: 'External Link / Other', value: 'external' }
				))
		.addStringOption(option => 
			option.setName('date')
				.setDescription('Date of the meeting (YYYY-MM-DD). Optional if instant.')
				.setRequired(false)
				.setAutocomplete(true))
		.addStringOption(option => 
			option.setName('time')
				.setDescription('Time of the meeting (HH:MM). Optional if instant.')
				.setRequired(false)
				.setAutocomplete(true))
		.addBooleanOption(option =>
			option.setName('instant')
				.setDescription('Schedule the meeting instantly (starts now)')
				.setRequired(false))
		.addUserOption(option => 
			option.setName('user-invite')
				.setDescription('Individual user to invite')
				.setRequired(false))
		.addRoleOption(option => 
			option.setName('role-invite')
				.setDescription('Entire role / team to invite')
				.setRequired(false))
		.addStringOption(option => 
			option.setName('location-details')
				.setDescription('External URL or channel name')
				.setRequired(false))
		.addStringOption(option => 
			option.setName('description')
				.setDescription('Meeting description or agenda')
				.setRequired(false))
		.addStringOption(option =>
			option.setName('external-emails')
				.setDescription('Additional external guest emails (comma separated)')
				.setRequired(false))
		.addStringOption(option =>
			option.setName('notes')
				.setDescription('Meeting notes or private agenda (visible in Google Calendar)')
				.setRequired(false))
		.addIntegerOption(option =>
			option.setName('duration')
				.setDescription('Duration of the meeting in minutes (default: 30)')
				.setRequired(false)
				.addChoices(
					{ name: '15 minutes', value: 15 },
					{ name: '30 minutes', value: 30 },
					{ name: '45 minutes', value: 45 }
				))
		.addStringOption(option =>
			option.setName('scope')
				.setDescription('Who can join the VC? e.g. open, hq, fork:delhi, network:tech, fork:delhi:tech')
				.setRequired(false)
				.setAutocomplete(true)),

	async execute(interaction) {
		const { isStaff, getForkLeadRole } = require('../lib/auth');
		const member = await interaction.guild.members.fetch(interaction.user.id);

		// Any BnB member can schedule — check for at least one membership role
		// (contributor, contributor-{city}, hq, fork-lead, staff, admin)
		const hasMembershipRole = (
			member.permissions.has('Administrator') ||
			isStaff(member, interaction.guild) ||
			(() => {
				const forkLeadRole = getForkLeadRole(interaction.guild);
				return forkLeadRole && member.roles.cache.has(forkLeadRole.id);
			})() ||
			member.roles.cache.some(r => {
				const n = r.name.toLowerCase();
				return n === 'contributor' || n === 'hq' || n.startsWith('contributor-');
			})
		);

		if (!hasMembershipRole) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
				.setDescription('You need to be a registered BnB team member to schedule meetings.')
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			return await interaction.reply({
				embeds: [unauthorizedEmbed],
				flags: [MessageFlags.Ephemeral]
			});
		}

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			const title = interaction.options.getString('title');
			const dateStr = interaction.options.getString('date');
			const timeStr = interaction.options.getString('time');
			const locationType = interaction.options.getString('location-type');
			const locationDetails = interaction.options.getString('location-details') || '';
			const description = interaction.options.getString('description') || '';
			const notes = interaction.options.getString('notes') || '';
			const userInvite = interaction.options.getUser('user-invite');
			const roleInvite = interaction.options.getRole('role-invite');
			const instant = interaction.options.getBoolean('instant') || false;
			const externalEmailsStr = interaction.options.getString('external-emails') || '';
			const duration = interaction.options.getInteger('duration') || 30;
			const scope = interaction.options.getString('scope') || 'invite';

			let scheduledTime;
			if (instant || (!dateStr && !timeStr)) {
				scheduledTime = Date.now();
			} else {
				if (!dateStr || !timeStr) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} You must specify both date and time, or set the instant option to True.`
					});
				}
				// Validate date & time in IST (UTC+5:30)
				const dateTimeStr = `${dateStr}T${timeStr}:00+05:30`;
				scheduledTime = Date.parse(dateTimeStr);
				if (isNaN(scheduledTime) || scheduledTime <= Date.now()) {
					return await interaction.editReply({
						content: `${config.EMOJIS.error} Invalid date/time. Ensure it is in the future and formatted as YYYY-MM-DD and HH:MM.`
					});
				}
			}

			const endTime = scheduledTime + duration * 60 * 1000;
			const externalEmails = externalEmailsStr
				? externalEmailsStr.split(',').map(e => e.trim().toLowerCase()).filter(e => e.includes('@'))
				: [];

			const guild = interaction.guild;

			const inviteesDisplay = [];
			const attendeesToAdd = [];
			// Add attendees
			if (userInvite) {
				inviteesDisplay.push(`<@${userInvite.id}>`);
				attendeesToAdd.push({ type: 'user', id: userInvite.id });
			}
			if (roleInvite) {
				inviteesDisplay.push(`<@&${roleInvite.id}>`);
				attendeesToAdd.push({ type: 'role', id: roleInvite.id });
			}

			if (inviteesDisplay.length === 0 && externalEmails.length === 0) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} You must specify at least one user, role invitee, or external email guest.`
				});
			}

			// Call Motherboard API to schedule meeting
			const { callMotherboard } = require('../lib/motherboardApi');
			const response = await callMotherboard('POST', '/api/meetings/schedule', 'discord_bot', {
				title,
				description,
				scheduled_time: scheduledTime,
				duration_minutes: duration,
				location_type: locationType,
				location_details: locationDetails,
				creator_id: interaction.user.id,
				invitees: attendeesToAdd,
				external_emails: externalEmails,
				notes,
				scope
			});

			// Normalize response
			const createdMeeting = {
				...response,
				scheduled_time: response.scheduled_time,
				attendees: (response.attendees || []).map(a => ({
					type: a.attendee_type,
					discordId: a.discord_id
				})),
				externalEmails: response.external_emails ? response.external_emails.split(',') : []
			};

			const timeDiff = scheduledTime - Date.now();
			const isInstant = timeDiff <= 5 * 60 * 1000;

			let vcLink = '';

			// Provision Voice Channel immediately for ALL voice meetings
			if (createdMeeting && locationType === 'discord_vc') {
				const vcChannel = await createMeetingVoiceChannel(guild, createdMeeting);
				if (vcChannel) {
					createdMeeting.temp_channel_id = vcChannel.id;
					vcLink = `https://discord.com/channels/${guild.id}/${vcChannel.id}`;

					// Update temp_channel_id on Motherboard
					await callMotherboard('PATCH', `/api/meetings/${createdMeeting.id}`, 'discord_bot', {
						temp_channel_id: vcChannel.id
					});
				}
			}

			// If scheduled within 5 minutes (or instantly), send DMs immediately
			if (isInstant && createdMeeting) {
				// Send DM notification to attendees immediately
				await sendMeetingDMs(guild, createdMeeting, vcLink);
				// Record that the 5-minute reminder has been sent so the scheduler doesn't run it again
				await meetingsDb.recordReminderSent(createdMeeting.id, '5m');
			}

			const istTimeString = new Date(scheduledTime).toLocaleString('en-US', {
				timeZone: 'Asia/Kolkata',
				hour12: true,
				hour: 'numeric',
				minute: '2-digit',
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			}) + ' IST';

			const embedTitle = isInstant 
				? `⚛️ MEETING_COMMENCEMENT // LIVE` 
				: `${config.EMOJIS.calendar} MEETING_SCHEDULED // CAL_ENTRY_CREATED`;
				
			const embedDescription = isInstant
				? `An instant meeting has been started by <@${interaction.user.id}>.`
				: `A new meeting has been scheduled by <@${interaction.user.id}>.`;

			const displayInvitees = [...inviteesDisplay];
			for (const email of externalEmails) {
				displayInvitees.push(`\`${email}\``);
			}

			const embed = new EmbedBuilder()
				.setTitle(embedTitle)
				.setDescription(embedDescription)
				.addFields(
					{ name: '📋 TITLE', value: title, inline: false },
					{ name: '🆔 MEETING ID', value: `\`${createdMeeting.id}\``, inline: false },
					{ name: '📅 SCHEDULED TIME (IST)', value: `\`${istTimeString}\` (<t:${Math.floor(scheduledTime / 1000)}:F> / <t:${Math.floor(scheduledTime / 1000)}:R>)`, inline: false },
					{ name: '⏱️ DURATION', value: `${duration} minutes`, inline: true },
					{ name: '🌐 LOCATION', value: locationType === 'discord_vc' ? 'Discord Temporary VC' : 'External Location', inline: true },
					{ name: '🔗 MEETING LINK', value: `https://cal.gobitsnbytes.org/m/${createdMeeting.meet_code}`, inline: false },
					{ name: '👥 INVITEES', value: displayInvitees.join(', ') || 'None', inline: false }
				)
				.setColor(isInstant ? config.COLORS.primary : config.COLORS.success)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			if (description) {
				embed.addFields({ name: '📝 AGENDA', value: description, inline: false });
			}
			if (notes) {
				embed.addFields({ name: '🗒️ MEETING NOTES', value: notes, inline: false });
			}

			// Post the confirmation in the events channel
			const { getEventsChannel } = require('../lib/calcomWebhook');
			const eventsChannel = await getEventsChannel(guild);
			if (eventsChannel) {
				await eventsChannel.send({
					content: `🔔 **Meeting Alert**: ${inviteesDisplay.join(' ')}`,
					embeds: [embed]
				});
			}

			// Reply to creator
			await interaction.editReply({
				content: `✅ Meeting successfully scheduled! Confirmation sent to channel.`,
				embeds: [embed]
			});
		} catch (error) {
			console.error('[MEET_SCHEDULE_ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to schedule meeting.`
			});
		}
	},

	async autocomplete(interaction) {
		const focusedOption = interaction.options.getFocused(true);

		if (focusedOption.name === 'scope') {
			// Build scope suggestions dynamically from guild roles
			const staticScopes = [
				{ name: 'invite — Explicit invitees only', value: 'invite' },
				{ name: 'open — All BnB members (contributors + HQ)', value: 'open' },
				{ name: 'hq — Foundation team only', value: 'hq' },
				{ name: 'network:tech — All tech members across forks', value: 'network:tech' },
				{ name: 'network:creative — All creative members across forks', value: 'network:creative' },
				{ name: 'network:ops — All ops members across forks', value: 'network:ops' },
				{ name: 'network:outreach — All outreach members across forks', value: 'network:outreach' },
				{ name: 'network:tech-lead — All tech leads (cross-fork council)', value: 'network:tech-lead' },
				{ name: 'network:creative-lead — All creative leads', value: 'network:creative-lead' },
				{ name: 'network:ops-lead — All ops leads', value: 'network:ops-lead' },
				{ name: 'network:outreach-lead — All outreach leads', value: 'network:outreach-lead' },
			];

			// Add fork-specific scopes from guild city roles
			const guild = interaction.guild;
			const cityRoles = guild.roles.cache
				.filter(r => r.name.toLowerCase().startsWith('contributor-'))
				.map(r => r.name.toLowerCase().replace('contributor-', ''));

			for (const city of cityRoles) {
				const cap = city.charAt(0).toUpperCase() + city.slice(1);
				staticScopes.push({ name: `fork:${city} — Entire ${cap} fork`, value: `fork:${city}` });
				for (const track of ['tech', 'creative', 'ops', 'outreach']) {
					staticScopes.push({
						name: `fork:${city}:${track} — ${cap} fork ${track} team only`,
						value: `fork:${city}:${track}`
					});
				}
			}

			const query = focusedOption.value.toLowerCase();
			const filtered = query
				? staticScopes.filter(s => s.value.includes(query) || s.name.toLowerCase().includes(query))
				: staticScopes;

			await interaction.respond(filtered.slice(0, 25)).catch(() => {});
			return;
		}

		if (focusedOption.name === 'date') {
			const choices = [];
			
			// Get offset to convert to IST (Asia/Kolkata)
			const getISTDate = (offsetDays) => {
				const d = new Date();
				const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
				const istTime = utc + (3600000 * 5.5);
				return new Date(istTime + (offsetDays * 24 * 60 * 60 * 1000));
			};

			for (let i = 0; i < 7; i++) {
				const targetDate = getISTDate(i);
				const year = targetDate.getFullYear();
				const month = String(targetDate.getMonth() + 1).padStart(2, '0');
				const day = String(targetDate.getDate()).padStart(2, '0');
				const valueStr = `${year}-${month}-${day}`;
				
				let label = '';
				if (i === 0) {
					label = `Today (${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
				} else if (i === 1) {
					label = `Tomorrow (${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
				} else {
					label = targetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
				}
				
				choices.push({ name: label, value: valueStr });
			}

			const filtered = choices.filter(choice => 
				choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
			);
			await interaction.respond(focusedOption.value ? filtered.slice(0, 25) : choices.slice(0, 25)).catch(() => {});
		}

		if (focusedOption.name === 'time') {
			const focusedValue = focusedOption.value;
			const choices = [];
			
			// Generate 30-minute intervals
			for (let hour = 0; hour < 24; hour++) {
				for (let min of ['00', '30']) {
					const hourStr = String(hour).padStart(2, '0');
					const timeVal = `${hourStr}:${min}`;
					
					const period = hour >= 12 ? 'PM' : 'AM';
					const displayHour = hour % 12 === 0 ? 12 : hour % 12;
					const label = `${String(displayHour).padStart(2, '0')}:${min} ${period} (IST)`;
					
					choices.push({ name: label, value: timeVal });
				}
			}

			const filtered = choices.filter(choice => 
				choice.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
				choice.value.includes(focusedValue)
			);
			
			await interaction.respond(focusedValue ? filtered.slice(0, 25) : choices.slice(0, 25)).catch(() => {});
		}
	}
};
