const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const fs = require('fs');
const { getActiveRecordings, stopRecording } = require('../lib/voiceRecorder');

module.exports = {
	noLog: true,
	data: new SlashCommandBuilder()
		.setName('ts-off')
		.setDescription('Emergency turn off recording/transcription for the current VC.')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addChannelOption(option =>
			option.setName('channel')
				.setDescription('The voice channel to turn off recording for (optional if you are in the VC)')
				.addChannelTypes(ChannelType.GuildVoice)
				.setRequired(false)
		),

	async execute(interaction) {
		const member = await interaction.guild.members.fetch(interaction.user.id);
		const executiveRoleId = process.env.EXECUTIVE_LEADERSHIP_ROLE_ID || '1506019032015310949';
		const hasRole = member.roles.cache.has(executiveRoleId) || member.permissions.has(PermissionFlagsBits.Administrator);

		if (!hasRole) {
			// Reply with a fake unknown command error to masquerade/hide the command's existence
			return await interaction.reply({
				content: 'Unknown command. Use `/help` to see all available commands.',
				flags: [MessageFlags.Ephemeral]
			});
		}

		let voiceChannelId = interaction.options.getChannel('channel')?.id;
		if (!voiceChannelId) {
			voiceChannelId = member.voice.channelId;
		}

		if (!voiceChannelId) {
			return await interaction.reply({
				content: 'You must specify a voice channel or join one to abort recording.',
				flags: [MessageFlags.Ephemeral]
			});
		}

		// Find the active recording session for the voice channel
		const activeSessions = getActiveRecordings();
		let targetSession = null;

		for (const [meetingId, session] of activeSessions) {
			if (session.channelId === voiceChannelId) {
				targetSession = session;
				break;
			}
		}

		if (!targetSession) {
			return await interaction.reply({
				content: 'No active recording found for the specified voice channel.',
				flags: [MessageFlags.Ephemeral]
			});
		}

		// Stop recording silently (preventing console logs and webhook logs) and purge
		try {
			const recordingData = await stopRecording(targetSession.meetingId, { silent: true });

			// Purge the temporary audio directory
			if (recordingData && recordingData.meetingDir) {
				if (fs.existsSync(recordingData.meetingDir)) {
					fs.rmSync(recordingData.meetingDir, { recursive: true, force: true });
				}
			}
		} catch (err) {
			// Suppressed: do not log to server console
		}

		// Reply ephemerally and schedule deletion of the reply to leave no trace in chat
		await interaction.reply({
			content: 'Recording aborted silently. Files purged.',
			flags: [MessageFlags.Ephemeral]
		});

		setTimeout(() => {
			interaction.deleteReply().catch(() => {});
		}, 1500);
	}
};
