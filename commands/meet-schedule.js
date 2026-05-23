const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('meet-schedule')
		.setDescription('Schedule a new meeting.')
		.addStringOption(option => 
			option.setName('title')
				.setDescription('The title/subject of the meeting')
				.setRequired(true))
		.addStringOption(option => 
			option.setName('date')
				.setDescription('Date of the meeting (YYYY-MM-DD)')
				.setRequired(true))
		.addStringOption(option => 
			option.setName('time')
				.setDescription('Time of the meeting in 24h format (HH:MM)')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('location-type')
				.setDescription('Where the meeting will take place')
				.setRequired(true)
				.addChoices(
					{ name: 'Discord Voice Channel', value: 'discord_vc' },
					{ name: 'External Link / Other', value: 'external' }
				))
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

			// Validate date & time
			const dateTimeStr = `${dateStr}T${timeStr}:00`;
			const scheduledTime = Date.parse(dateTimeStr);
			if (isNaN(scheduledTime) || scheduledTime <= Date.now()) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Invalid date/time. Ensure it is in the future and formatted as YYYY-MM-DD and HH:MM.`
				});
			}

			// Generate a unique ID
			const id = `meet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

			// Create the meeting record
			await meetingsDb.createMeeting({
				id,
				title,
				description,
				scheduledTime,
				locationType,
				locationDetails,
				creatorId: interaction.user.id
			});

			const inviteesDisplay = [];
			// Add attendees
			if (userInvite) {
				await meetingsDb.addAttendee(id, 'user', userInvite.id);
				inviteesDisplay.push(`<@${userInvite.id}>`);
			}
			if (roleInvite) {
				await meetingsDb.addAttendee(id, 'role', roleInvite.id);
				inviteesDisplay.push(`<@&${roleInvite.id}>`);
			}

			if (inviteesDisplay.length === 0) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} You must specify at least a user or a role invitee.`
				});
			}

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.calendar} MEETING_SCHEDULED // CAL_ENTRY_CREATED`)
				.setDescription(`A new meeting has been scheduled by <@${interaction.user.id}>.`)
				.addFields(
					{ name: '📋 TITLE', value: title, inline: false },
					{ name: '📅 SCHEDULED TIME', value: `<t:${Math.floor(scheduledTime / 1000)}:F> (<t:${Math.floor(scheduledTime / 1000)}:R>)`, inline: false },
					{ name: '🌐 LOCATION', value: locationType === 'discord_vc' ? 'Discord Temporary VC' : (locationDetails || 'External Link'), inline: true },
					{ name: '👥 INVITEES', value: inviteesDisplay.join(', '), inline: true }
				)
				.setColor(config.COLORS.success)
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
	}
};
