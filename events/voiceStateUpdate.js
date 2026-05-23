const { Events } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');

module.exports = {
	name: Events.VoiceStateUpdate,
	async execute(oldState, newState) {
		// Detect if a user left a voice channel
		const oldChannelId = oldState.channelId;
		const newChannelId = newState.channelId;

		if (oldChannelId && oldChannelId !== newChannelId) {
			const oldChannel = oldState.channel;
			if (!oldChannel) return;

			// If the voice channel is now empty
			if (oldChannel.members.size === 0) {
				try {
					// Check if this channel is a temporary meeting VC
					const meeting = await meetingsDb.findMeetingByTempChannel(oldChannelId);
					
					// Only clean up if the meeting is currently 'active' or 'scheduled'
					if (meeting && (meeting.status === 'active' || meeting.status === 'scheduled')) {
						console.log(`[MEETING] Temporary VC ${oldChannel.name} (${oldChannelId}) is now empty. Deleting...`);
						
						await oldChannel.delete('Temporary meeting VC has ended (all users left).').catch(err => {
							console.error(`[MEETING ERROR] Failed to delete temporary VC:`, err.message);
						});

						// Mark meeting as completed
						await meetingsDb.updateMeetingStatus(meeting.id, 'completed');
						console.log(`[MEETING] Meeting "${meeting.title}" (${meeting.id}) marked as completed.`);
					}
				} catch (error) {
					console.error('[MEETING ERROR] Error checking temporary VC status:', error);
				}
			}
		}
	}
};
