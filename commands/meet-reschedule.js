const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const { isStaff } = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('meet-reschedule')
		.setDescription('Reschedule an existing meeting.')
		.addStringOption(option => 
			option.setName('meeting-id')
				.setDescription('The ID of the meeting to reschedule')
				.setRequired(true)
				.setAutocomplete(true))
		.addStringOption(option => 
			option.setName('date')
				.setDescription('New date of the meeting (YYYY-MM-DD)')
				.setRequired(true)
				.setAutocomplete(true))
		.addStringOption(option => 
			option.setName('time')
				.setDescription('New time of the meeting (HH:MM)')
				.setRequired(true)
				.setAutocomplete(true))
		.addStringOption(option => 
			option.setName('reason')
				.setDescription('Reason for rescheduling (optional)')
				.setMaxLength(500)
				.setRequired(false)),

	async execute(interaction) {
		const member = await interaction.guild.members.fetch(interaction.user.id);
		
		const isAuthorized = isStaff(member, interaction.guild) || member.permissions.has('Administrator');
		
		if (!isAuthorized) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
				.setDescription('Your credentials do not grant access to reschedule meetings.')
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			return await interaction.reply({ 
				embeds: [unauthorizedEmbed], 
				flags: [MessageFlags.Ephemeral] 
			});
		}

		const privacy = config.PRIVACY['meet-reschedule'] !== false;
		await interaction.deferReply({ flags: privacy ? [MessageFlags.Ephemeral] : [] });

		try {
			const { callMotherboard } = require('../lib/motherboardApi');
			const meetingId = interaction.options.getString('meeting-id');
			const dateStr = interaction.options.getString('date');
			const timeStr = interaction.options.getString('time');
			const reason = interaction.options.getString('reason');

			// Validate date & time in IST (UTC+5:30)
			const dateTimeStr = `${dateStr}T${timeStr}:00+05:30`;
			const newScheduledMs = Date.parse(dateTimeStr);
			if (isNaN(newScheduledMs) || newScheduledMs <= Date.now()) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Invalid date/time. Ensure it is in the future and formatted as YYYY-MM-DD and HH:MM.`
				});
			}

			// Fetch current meeting
			const meeting = await callMotherboard('GET', `/api/meetings/${meetingId}`, interaction.user.id);
			if (!meeting || meeting.error) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Could not find meeting with ID \`${meetingId}\`.`
				});
			}

			// Compute new end time preserving duration
			const durationMs = (meeting.end_time || (meeting.scheduled_time + 30 * 60 * 1000)) - meeting.scheduled_time;
			const newEndMs = newScheduledMs + durationMs;

			console.log(`[MEET-RESCHEDULE] Rescheduling meeting (${meetingId}) triggered by ${interaction.user.tag}`);

			// Call motherboard to update the meeting
			await callMotherboard('PATCH', `/api/meetings/${meetingId}`, interaction.user.id, {
				scheduled_time: newScheduledMs,
				end_time: newEndMs
			});

			let successMessage = `✅ Meeting "**${meeting.title}**" has been rescheduled successfully.`;
			if (reason) {
				successMessage += `\n**Reason:** ${reason}`;
			}

			const istTimeString = new Date(newScheduledMs).toLocaleString('en-US', {
				timeZone: 'Asia/Kolkata',
				hour12: true,
				hour: 'numeric',
				minute: '2-digit',
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			}) + ' IST';

			const successEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.calendar} Meeting Rescheduled`)
				.setDescription(successMessage)
				.addFields(
					{ name: '🆔 MEETING ID', value: `\`${meeting.id}\``, inline: false },
					{ name: '📅 NEW SCHEDULED TIME (IST)', value: `\`${istTimeString}\` (<t:${Math.floor(newScheduledMs / 1000)}:F> / <t:${Math.floor(newScheduledMs / 1000)}:R>)`, inline: false }
				)
				.setColor(config.COLORS.warning)
				.setFooter({ text: config.BRANDING.footerText });

			// Post to events channel if exists
			try {
				const eventsChannel = interaction.guild.channels.cache.get(config.CHANNEL_IDS.events);
				if (eventsChannel) {
					await eventsChannel.send({ embeds: [successEmbed] });
				}
			} catch (e) {
				console.warn('[MEET-RESCHEDULE] Could not post to events channel', e);
			}

			await interaction.editReply({
				content: `✅ Meeting successfully rescheduled! Confirmation sent to channel.`,
				embeds: [successEmbed]
			});

		} catch (error) {
			console.error('[MEET-RESCHEDULE-ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to reschedule meeting.`
			});
		}
	},

	async autocomplete(interaction) {
		const focusedOption = interaction.options.getFocused(true);

		if (focusedOption.name === 'meeting-id') {
			try {
				const { callMotherboard } = require('../lib/motherboardApi');
				const meetings = await callMotherboard('GET', '/api/meetings', 'discord_bot');
				const choices = meetings
					.filter(m => m.status === 'scheduled' || m.status === 'active')
					.map(m => {
						return {
							name: `[${m.status}] ${m.title.substring(0, 50)} (${m.id})`,
							value: m.id
						};
					});

				const query = focusedOption.value.toLowerCase();
				const filtered = choices.filter(choice => 
					choice.name.toLowerCase().includes(query) || choice.value.includes(query)
				);

				await interaction.respond(filtered.slice(0, 25)).catch(() => {});
			} catch (err) {
				console.error('[MEET-RESCHEDULE-AUTOCOMPLETE-ERROR]', err);
			}
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

			for (let i = 0; i < 14; i++) {
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
			return;
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
			return;
		}
	}
};
