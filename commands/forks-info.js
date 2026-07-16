const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
const auth = require('../lib/auth');
const db = require('../lib/db');

function buildEmbed(active, pending, activeStats, timestamp, guild, leadNames = {}) {
	const embed = new EmbedBuilder()
		.setTitle(`📡 NETWORK_TOPOLOGY // NET_STATUS_RECAP`)
		.setDescription(`Real-time synchronization status and telemetry of all active and discovery nodes.`)
		.setColor(config.COLORS.primary)
		.setTimestamp(timestamp ? new Date(timestamp) : new Date());

	if (config.UI && config.UI.useServerIcon && guild) {
		embed.setThumbnail(guild.iconURL());
	}

	// Active Nodes List
	let activeList = '';
	if (active.length === 0) {
		activeList = `*No active nodes found.*`;
	} else {
		active.forEach(f => {
			const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
						 f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
						 'UNKNOWN').toUpperCase();
			const leadId = notion.getLeadDiscordId(f);
			const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
			const health = f.properties?.['Health Score']?.number || 0;
			const points = f.properties?.['Points']?.number || 0;
			const teamCount = activeStats[f.id] || 0;

			const displayName = leadNames[leadId] || leadName;
			const leadDisplay = leadId ? (displayName ? `${displayName} (<@${leadId}>)` : `<@${leadId}>`) : (leadName || 'ANONYMOUS');
			activeList += `🟢 **${city}** — Lead: ${leadDisplay}\n▪ Points: \`${points}\` | Health: \`${health}/100\` | Team: \`${teamCount} members\`\n\n`;
		});
	}
	embed.addFields({ name: '🟢 ACTIVE NODES (ONLINE)', value: activeList.trim() });

	// Pending Nodes List
	let pendingList = '';
	if (pending.length === 0) {
		pendingList = `*No pending discovery nodes found.*`;
	} else {
		pending.forEach(f => {
			const city = (f.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
						 f.properties?.["Fork Name"]?.title?.[0]?.text?.content || 
						 'PENDING').toUpperCase();
			const leadName = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
			const leadDisplay = leadName ? `(${leadName})` : 'ANONYMOUS';
			pendingList += `⏳ **${city}** — Applicant: ${leadDisplay} | Status: \`Pending\`\n`;
		});
	}
	embed.addFields({ name: '⏳ PENDING NODES (DISCOVERY)', value: pendingList.trim() });

	// Summary Block
	const totalActive = active.length;
	const totalPending = pending.length;
	const totalPoints = active.reduce((sum, f) => sum + (f.properties?.['Points']?.number || 0), 0);
	
	embed.addFields({
		name: '📊 SYSTEM METRICS',
		value: `▪ Active Nodes: \`${totalActive}\`\n▪ Pending Nodes: \`${totalPending}\`\n▪ Network Footprint: \`${totalActive + totalPending}\`\n▪ Total Points: \`${totalPoints}\``,
		inline: false
	});

	embed.setFooter({ text: 'BITS&BYTES // TOPOLOGY CONTROL' });

	return embed;
}

function buildButtons() {
	const refreshButton = new ButtonBuilder()
		.setCustomId('refresh_forks_info')
		.setLabel('REFRESH_DATA 🔄')
		.setStyle(ButtonStyle.Primary);

	const notionButton = new ButtonBuilder()
		.setLabel('NOTION_REGISTRY ↗️')
		.setURL('https://www.notion.so/a547258573cd4f6c99b840c7cb63ce9e?v=27122dc6b74b4dc8bc0b7c77fef75871&source=copy_link')
		.setStyle(ButtonStyle.Link);

	return new ActionRowBuilder().addComponents(refreshButton, notionButton);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('forks-info')
		.setDescription('Post or update a single embed listing all active and pending forks info.'),

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
			// Ensure table exists for tracking settings (idempotent - safe in all environments)
			await db.run(`
				CREATE TABLE IF NOT EXISTS bot_settings (
					key TEXT PRIMARY KEY,
					val TEXT
				)
			`).catch(() => {}); // Ignore if already exists (PG throws on IF NOT EXISTS race)

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

			// Get team members counts and pre-fetch lead names with concurrency limiting (max 3 req/s)
			const activeStats = {};
			const leadNames = {};
			const tasks = active.map(f => async () => {
				try {
					const team = await notion.getTeamMembers(f.id);
					activeStats[f.id] = team.length;
				} catch (e) {
					activeStats[f.id] = 0;
				}

				const leadId = notion.getLeadDiscordId(f);
				if (leadId) {
					try {
						const m = await interaction.guild.members.fetch(leadId);
						leadNames[leadId] = m.displayName;
					} catch (e) {
						leadNames[leadId] = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
					}
				}
			});
			await notion.limitConcurrency(tasks, 3);

			const embed = buildEmbed(active, pending, activeStats, Date.now(), interaction.guild, leadNames);
			const buttons = buildButtons();

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
							await targetMsg.edit({ embeds: [embed], components: [buttons] });
							edited = true;
						}
					}
				} catch (e) {
					console.error('[FORKS_INFO] Failed to fetch/edit stored message:', e.message);
				}
			}

			if (!edited) {
				// Send new message in the current channel
				const newMsg = await interaction.channel.send({ embeds: [embed], components: [buttons] });
				await db.run(
					`INSERT OR REPLACE INTO bot_settings (key, val) VALUES (?, ?)`,
					['fork_info_msg', JSON.stringify({ channelId: interaction.channelId, messageId: newMsg.id })]
				);
				await interaction.editReply({
					content: `✅ New fork info dashboard posted! [Jump to message](${newMsg.url})`
				});
			} else {
				await interaction.editReply({
					content: `✅ Existing fork info dashboard updated! [Jump to message](${targetMsg.url})`
				});
			}

		} catch (error) {
			console.error('[FORKS_INFO_ERROR]', error);
			await interaction.editReply({
				content: `❌ SYSTEM_FAILURE: Unable to post/update fork info. Error: ${error.message}`
			});
		}
	},

	// Button handler method
	async handleButton(interaction) {
		const member = await interaction.guild.members.fetch(interaction.user.id);
		const isAuthorized = auth.isStaff(member, interaction.guild);

		if (!isAuthorized) {
			return await interaction.reply({
				content: `❌ You do not have permission to refresh this dashboard.`,
				flags: [MessageFlags.Ephemeral]
			});
		}

		await interaction.deferUpdate();

		try {
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

			const activeStats = {};
			const leadNames = {};
			const tasks = active.map(f => async () => {
				try {
					const team = await notion.getTeamMembers(f.id);
					activeStats[f.id] = team.length;
				} catch (e) {
					activeStats[f.id] = 0;
				}

				const leadId = notion.getLeadDiscordId(f);
				if (leadId) {
					try {
						const m = await interaction.guild.members.fetch(leadId);
						leadNames[leadId] = m.displayName;
					} catch (e) {
						leadNames[leadId] = f.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content;
					}
				}
			});
			await notion.limitConcurrency(tasks, 3);

			const embed = buildEmbed(active, pending, activeStats, Date.now(), interaction.guild, leadNames);
			const buttons = buildButtons();

			await interaction.message.edit({ embeds: [embed], components: [buttons] });

		} catch (error) {
			console.error('[FORKS_INFO_REFRESH_ERROR]', error);
			// We can't reply to a deferred update easily with follow-up if we want it ephemeral
			await interaction.followUp({
				content: `❌ Failed to refresh topology data: ${error.message}`,
				flags: [MessageFlags.Ephemeral]
			}).catch(() => null);
		}
	}
};
