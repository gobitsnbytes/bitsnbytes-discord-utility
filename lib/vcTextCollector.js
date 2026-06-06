/**
 * 🎙️ VC Text Collector — Captures text messages from Discord voice channel chat
 * Part of the Bits&Bytes Meeting Transcript Agent
 */

/**
 * Collects text messages sent in a Discord voice channel's integrated text chat.
 * Listens for messageCreate events filtered to a specific channel ID.
 */
class VcTextCollector {
	/**
	 * @param {string} channelId - The voice channel ID to monitor
	 * @param {import('discord.js').Client} client - The Discord.js client
	 * @param {Function} [onCommand] - Optional command callback
	 */
	constructor(channelId, client, onCommand) {
		this.channelId = channelId;
		this.messages = [];
		this._client = client;

		this._handler = async (message) => {
			if (message.channel.id !== this.channelId) return;
			if (message.author.bot) return;

			// Handle voice channel chat commands
			const contentTrimmed = (message.content || '').trim().toLowerCase();
			if (contentTrimmed === '!hindi' || contentTrimmed === '!play-hindi') {
				if (onCommand) {
					await onCommand('hindi');
					// Acknowledge the command in the chat
					await message.reply('🔊 Playing Hindi recording notice... / हिन्दी रिकॉर्डिंग सूचना चलाई जा रही है...').catch(() => {});
				}
			}

			// Skip bot command triggers — they're operational, not meeting content
			if (contentTrimmed === '!hindi' || contentTrimmed === '!play-hindi') return;

			this.messages.push({
				author: message.member?.displayName || message.author.displayName || message.author.username,
				authorId: message.author.id,
				content: message.content || '',
				timestamp: message.createdTimestamp,
				attachments: [...message.attachments.values()].map(a => a.name),
			});
		};

		client.on('messageCreate', this._handler);
		console.log(`[VC_TEXT] Started collecting text messages for channel ${channelId}`);
	}

	/**
	 * Stop collecting messages and clean up the listener.
	 * @returns {Array<{author: string, authorId: string, content: string, timestamp: number, attachments: string[]}>}
	 */
	stop() {
		if (this._client && this._handler) {
			this._client.removeListener('messageCreate', this._handler);
			this._handler = null;
			console.log(`[VC_TEXT] Stopped collecting for channel ${this.channelId}. Captured ${this.messages.length} messages.`);
		}
		return this.messages;
	}
}

module.exports = { VcTextCollector };
