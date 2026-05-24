const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
const auth = require('../lib/auth');
const db = require('../lib/db');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('forks-info')
		.setDescription('Post or update a single text message listing all active and pending forks info.'),

	async execute(interaction) {
		const member = await interaction.guild.members.fetch(interaction.user.id);
		const isAuthorized = auth.isStaff(member, interaction.guild);

		if (!isAuthorized) {
			return await interaction.reply({
				content: `❌ You do not have permission to run this command. Only staff members can run this.`,
				flags: [MessageFlags.Ephemeral]
			});
		}

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			// Ensure table exists for tracking settings
			await db.run(`
				CREATE TABLE IF NOT EXISTS bot_settings (
					key TEXT PRIMARY KEY,
					val TEXT
				)
			`);

			// Query forks
			const forks = await notion.getForks();

			const isValidFork = (f) => {
				const city = f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content;
				const name = f.properties?.["Fork Name"]?.title?.[0]?.text?.content;
				const altCity = f.properties?.City?.rich_text?.[0]?.text?.content;
				return city || name || altCity;
			};

			const active = forks
				.filter(isValidFork)
				.filter(f => f.properties?.Status?.select?.name === 'Active');

			const pending = forks
				.filter(isValidFork)
				.filter(f => f.properties?.Status?.select?.name === 'Pending');

			// Format text
			let text = `📡 **BITS&BYTES // NODE TOPOLOGY DATA**\n`;
			text += `==================================================\n\n`;

			text += `🟢 **ACTIVE NODES (ONLINE):**\n`;
			if (active.length === 0) {
				text += `• \`NO_ACTIVE_PROTOCOLS_FOUND\`\n`;
			} else {
				for (const f of active) {
					const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
								 f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
								 'UNKNOWN').toUpperCase();
					const leadId = notion.getLeadDiscordId(f);
					const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
					const health = f.properties?.['Health Score']?.number || 0;
					const points = f.properties?.['Points']?.number || 0;

					const leadDisplay = leadId ? `<@${leadId}>` : (leadName || 'ANONYMOUS');
					
					// Get team members count
					let teamCount = 0;
					try {
						const team = await notion.getTeamMembers(f.id);
						teamCount = team.length;
					} catch (e) {}

					text += `• **${city}** — Lead: ${leadDisplay} | Health: \`${health}/100\` | Points: \`${points}\` | Team: \`${teamCount} members\`\n`;
				}
			}

			text += `\n⏳ **PENDING NODES (DISCOVERY):**\n`;
			if (pending.length === 0) {
				text += `• \`NO_PENDING_SYNCHRONIZATIONS\`\n`;
			} else {
				for (const f of pending) {
					const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
								 f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
								 'PENDING').toUpperCase();
					const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
					const leadDisplay = leadName ? `(${leadName})` : 'ANONYMOUS';

					text += `• **${city}** — Applicant: ${leadDisplay}\n`;
				}
			}

			text += `\n*Last Updated: <t:${Math.floor(Date.now() / 1000)}:f>*\n`;
			text += `==================================================\n`;

			// Check if we have a stored message
			const row = await db.get(`SELECT val FROM bot_settings WHERE key = ?`, ['fork_info_msg']);
			let edited = false;
			let targetMsg = null;

			if (row) {
				try {
					const { channelId, messageId } = JSON.parse(row.val);
					const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
					if (channel) {
						targetMsg = await channel.messages.fetch(messageId).catch(() => null);
						if (targetMsg) {
							await targetMsg.edit({ content: text });
							edited = true;
						}
					}
				} catch (e) {
					console.error('[FORKS_INFO] Failed to fetch/edit stored message:', e.message);
				}
			}

			if (!edited) {
				// Send new message in the current channel
				const newMsg = await interaction.channel.send({ content: text });
				await db.run(
					`INSERT OR REPLACE INTO bot_settings (key, val) VALUES (?, ?)`,
					['fork_info_msg', JSON.stringify({ channelId: interaction.channelId, messageId: newMsg.id })]
				);
				await interaction.editReply({
					content: `✅ New fork info message posted! [Jump to message](${newMsg.url})`
				});
			} else {
				await interaction.editReply({
					content: `✅ Existing fork info message updated! [Jump to message](${targetMsg.url})`
				});
			}

		} catch (error) {
			console.error('[FORKS_INFO_ERROR]', error);
			await interaction.editReply({
				content: `❌ SYSTEM_FAILURE: Unable to post/update fork info. Error: ${error.message}`
			});
		}
	},
};
