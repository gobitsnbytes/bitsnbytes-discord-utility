const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const { isStaff } = require('../lib/auth');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('meet-cancel')
		.setDescription('Cancel an active or scheduled meeting.')
		.addStringOption(option => 
			option.setName('meeting-id')
				.setDescription('The ID of the meeting to cancel')
				.setRequired(true)
				.setAutocomplete(true))
		.addStringOption(option => 
			option.setName('reason')
				.setDescription('Reason for cancellation (optional)')
				.setMaxLength(500)
				.setRequired(false)),

	async execute(interaction) {
		const member = await interaction.guild.members.fetch(interaction.user.id);
		
		const isAuthorized = isStaff(member, interaction.guild) || member.permissions.has('Administrator');
		
		if (!isAuthorized) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
				.setDescription('Your credentials do not grant access to cancel meetings.')
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			return await interaction.reply({ 
				embeds: [unauthorizedEmbed], 
				flags: [MessageFlags.Ephemeral] 
			});
		}

		const privacy = config.PRIVACY['meet-cancel'] !== false;
		await interaction.deferReply({ flags: privacy ? [MessageFlags.Ephemeral] : [] });

		try {
			const { callMotherboard } = require('../lib/motherboardApi');
			const meetingId = interaction.options.getString('meeting-id');
			const reason = interaction.options.getString('reason');

			if (!meetingId) {
				return await interaction.editReply({
					content: `${config.EMOJIS.error} Please provide a meeting ID.`
				});
			}

			console.log(`[MEET-CANCEL] Manually cancelling meeting (${meetingId}) triggered by ${interaction.user.tag}`);

			// Call motherboard to delete the meeting
			await callMotherboard('DELETE', `/api/meetings/${meetingId}`, interaction.user.id);

			let successMessage = `✅ Meeting has been cancelled successfully.`;
			if (reason) {
				successMessage += `\n**Reason:** ${reason}`;
			}

			const successEmbed = new EmbedBuilder()
				.setTitle('Meeting Cancelled')
				.setDescription(successMessage)
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			// Post to events channel if exists
			try {
				const eventsChannel = interaction.guild.channels.cache.get(config.CHANNEL_IDS.events);
				if (eventsChannel) {
					await eventsChannel.send({ embeds: [successEmbed] });
				}
			} catch (e) {
				console.warn('[MEET-CANCEL] Could not post to events channel', e);
			}

			await interaction.editReply({
				content: successMessage,
				embeds: [successEmbed]
			});

		} catch (error) {
			console.error('[MEET-CANCEL-ERROR]', error);
			await interaction.editReply({
				content: `${config.EMOJIS.error} SYSTEM_FAILURE: Unable to cancel meeting.`
			});
		}
	},

	async autocomplete(interaction) {
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

			const focusedValue = interaction.options.getFocused() || '';
			const filtered = choices.filter(choice => 
				choice.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
				choice.value.includes(focusedValue)
			);

			await interaction.respond(filtered.slice(0, 25)).catch(() => {});
		} catch (err) {
			console.error('[MEET-CANCEL-AUTOCOMPLETE-ERROR]', err);
		}
	}
};
