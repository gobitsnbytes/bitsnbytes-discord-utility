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
        this.flushing = false;
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
            if (this.queue.length >= 100) {
                this.queue.shift(); // drop oldest to prevent leak
            }
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
                let detailsStr = '';
                try {
                    if (details instanceof Error) {
                        detailsStr = details.stack || `${details.name}: ${details.message}`;
                    } else if (typeof details === 'object' && details !== null && (details.message || details.stack)) {
                        detailsStr = details.stack || details.message;
                        if (details.code) detailsStr = `Code ${details.code}: ${detailsStr}`;
                    } else {
                        detailsStr = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
                    }
                } catch (e) {
                    detailsStr = String(details);
                }
                
                // Safe truncation
                const finalDetails = detailsStr.length > 1018 ? detailsStr.slice(0, 1015) + '...' : detailsStr;
                
                // Use ANSI block colors matching the type
                let ansiColor = '\u001b[0;37m'; // White
                if (type === 'ERROR' || type === 'CMD_ERROR') ansiColor = '\u001b[0;31m'; // Red
                else if (type === 'WARN') ansiColor = '\u001b[0;33m'; // Yellow
                else if (type === 'SUCCESS' || type === 'BOOT') ansiColor = '\u001b[0;32m'; // Green
                else if (type === 'INFO' || type === 'COMMAND') ansiColor = '\u001b[0;36m'; // Cyan

                embed.addFields({ name: 'Details', value: `\`\`\`ansi\n\u001b[1m[${type}]\u001b[0m\n${ansiColor}${finalDetails}\u001b[0m\n\`\`\`` });
            }

            if (user) {
                embed.addFields({ name: 'Operator', value: `${user.username} (${user.id})`, inline: true });
            }

            if (command) {
                embed.addFields({ name: 'Command', value: `\`/${command}\``, inline: true });
            }

            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('[LOGGER ERROR] Failed to send to Discord:', err.message);
        }
    }

    async _flushQueue() {
        if (this.flushing) return;
        if (this.queue.length === 0) return;
        if (!this.client || !this.client.isReady()) return;

        this.flushing = true;
        console.log(`[LOGGER] Flushing ${this.queue.length} queued logs...`);
        while (this.queue.length > 0) {
            const log = this.queue.shift();
            await this._sendToDiscord(log);
            // Stagger flushes with 500ms delay to prevent rate limit
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        this.flushing = false;
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

    command(interaction, status = 'SUCCESS', details = null) {
        const type = status === 'ERROR' ? 'CMD_ERROR' : 'COMMAND';
        let color = status === 'ERROR' ? config.COLORS.error : config.COLORS.success;
        
        let message = 'Command executed successfully';
        if (status === 'ERROR') message = 'Failure in command execution';
        if (status === 'START') {
            message = 'Command execution initiated';
            color = config.COLORS.primary;
        }
        
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
