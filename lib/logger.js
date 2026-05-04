/**
 * 🛰️ BITS&BYTES PROTOCOL - LOGGING ENGINE
 * Version: 1.0.0
 * Purpose: Centralized logging with Discord channel mirroring
 */

const { EmbedBuilder } = require('discord.js');
const config = require('../config');

class Logger {
    constructor() {
        this.client = null;
        this.logChannelId = process.env.LOG_CHANNEL_ID || '1500952286858580089';
        this.queue = [];
    }

    /**
     * Initialize the logger with the Discord client
     * @param {Object} client - Discord client instance
     */
    init(client) {
        this.client = client;
        console.log('[LOGGER] Discord mirror initialized.');
        this._flushQueue();
    }

    /**
     * Send a log to Discord if possible, otherwise queue it
     * @param {Object} options - Log options
     */
    async _sendToDiscord({ type, message, details, color, user, command, mirror = true }) {
        const timestamp = new Date().toISOString();
        
        // Console output (always)
        const consolePrefix = `[${type}]`.padEnd(10);
        console.log(`${consolePrefix} ${message}${details ? ' | ' + details : ''}`);

        if (!this.logChannelId || !mirror) return;

        if (!this.client || !this.client.isReady()) {
            this.queue.push({ type, message, details, color, user, command, timestamp, mirror });
            return;
        }

        try {
            const channel = await this.client.channels.fetch(this.logChannelId).catch(() => null);
            if (!channel) return;

            const embed = new EmbedBuilder()
                .setColor(color || config.COLORS.primary)
                .setTitle(`${type} // SYSTEM_LOG`)
                .setDescription(message)
                .setTimestamp(new Date(timestamp))
                .setFooter({ text: `BITS&BYTES // ${type}_PROTOCOL` });

            if (details) {
                embed.addFields({ name: 'Details', value: `\`\`\`${details.substring(0, 1000)}\`\`\`` });
            }

            if (user) {
                embed.addFields({ name: 'Operator', value: `${user.tag} (${user.id})`, inline: true });
            }

            if (command) {
                embed.addFields({ name: 'Command', value: `\`/${command}\``, inline: true });
            }

            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('[LOGGER ERROR] Failed to send to Discord:', err.message);
        }
    }

    _flushQueue() {
        if (this.queue.length === 0) return;
        if (!this.client || !this.client.isReady()) return;

        console.log(`[LOGGER] Flushing ${this.queue.length} queued logs...`);
        while (this.queue.length > 0) {
            const log = this.queue.shift();
            this._sendToDiscord(log);
        }
    }

    info(message, details = null) {
        this._sendToDiscord({ type: 'INFO', message, details, color: config.COLORS.primary });
    }

    warn(message, details = null) {
        this._sendToDiscord({ type: 'WARN', message, details, color: config.COLORS.warning });
    }

    error(message, error = null) {
        const details = error instanceof Error ? error.stack : error;
        this._sendToDiscord({ type: 'ERROR', message, details, color: config.COLORS.error });
    }

    boot(message, details = null, mirror = true) {
        this._sendToDiscord({ type: 'BOOT', message, details, color: config.COLORS.success, mirror });
    }

    command(interaction, status = 'EXECUTE', details = null) {
        const type = status === 'ERROR' ? 'CMD_ERROR' : 'COMMAND';
        const color = status === 'ERROR' ? config.COLORS.error : config.COLORS.success;
        const message = status === 'ERROR' ? `Failure in command execution` : `Command executed successfully`;
        
        this._sendToDiscord({
            type,
            message,
            details,
            color,
            user: interaction.user,
            command: interaction.commandName
        });
    }
}

module.exports = new Logger();
