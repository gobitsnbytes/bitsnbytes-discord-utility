const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');
const { createMeetingVoiceChannel, sendMeetingDMs } = require('../lib/meetingsHelper');

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
				.setRequired(false)),

	async execute(interaction) {
		const allowedRoles = ['1506019068132462804', '1506323726223016149', '1480620981587279993'];
		const member = await interaction.guild.members.fetch(interaction.user.id);
		
		const isAuthorized = allowedRoles.some(roleId => member.roles.cache.has(roleId)) || member.permissions.has('Administrator');
		
		if (!isAuthorized) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
				.setDescription('Your credentials do not grant access to schedule meetings.')
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
			const userInvite = interaction.options.getUser('user-invite');
			const roleInvite = interaction.options.getRole('role-invite');
			const instant = interaction.options.getBoolean('instant') || false;

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

			// Generate a unique ID
			const id = `meet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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

			if (inviteesDisplay.length === 0) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} You must specify at least a user or a role invitee.`
				});
			}

			const timeDiff = scheduledTime - Date.now();
			const isInstant = timeDiff <= 5 * 60 * 1000;
			
			let initialStatus = 'scheduled';
			if (isInstant) {
				initialStatus = locationType === 'discord_vc' ? 'active' : 'completed';
			}

			// Create the meeting record
			await meetingsDb.createMeeting({
				id,
				title,
				description,
				scheduledTime,
				locationType,
				locationDetails,
				creatorId: interaction.user.id,
				status: initialStatus
			});

			for (const att of attendeesToAdd) {
				await meetingsDb.addAttendee(id, att.type, att.id);
			}

			let vcLink = '';
			
			// If scheduled within 5 minutes (or instantly), provision VC and send DMs immediately
			if (isInstant) {
				const createdMeeting = await meetingsDb.getMeeting(id);
				if (createdMeeting) {
					if (locationType === 'discord_vc') {
						const vcChannel = await createMeetingVoiceChannel(guild, createdMeeting);
						if (vcChannel) {
							vcLink = `https://discord.com/channels/${guild.id}/${vcChannel.id}`;
						}
					}
					// Send DM notification to attendees immediately
					await sendMeetingDMs(guild, createdMeeting, vcLink);
					// Record that the 5-minute reminder has been sent so the scheduler doesn't run it again
					await meetingsDb.recordReminderSent(id, '5m');
				}
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

			const embed = new EmbedBuilder()
				.setTitle(embedTitle)
				.setDescription(embedDescription)
				.addFields(
					{ name: '📋 TITLE', value: title, inline: false },
					{ name: '📅 SCHEDULED TIME (IST)', value: `\`${istTimeString}\` (<t:${Math.floor(scheduledTime / 1000)}:F> / <t:${Math.floor(scheduledTime / 1000)}:R>)`, inline: false },
					{ name: '🌐 LOCATION', value: locationType === 'discord_vc' ? (vcLink ? `🔊 [Click to Join VC](${vcLink})` : 'Discord Temporary VC') : (locationDetails || 'External Link'), inline: true },
					{ name: '👥 INVITEES', value: inviteesDisplay.join(', '), inline: true }
				)
				.setColor(isInstant ? config.COLORS.primary : config.COLORS.success)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			if (description) {
				embed.addFields({ name: '📝 DESCRIPTION', value: description, inline: false });
			}

			// Post the confirmation in the alerts channel
			const eventsChannel = interaction.guild.channels.cache.find(c => c.name === 'events' || c.name === 'pulse' || c.name === 'leads-council');
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
