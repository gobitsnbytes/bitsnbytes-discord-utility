/**
 * 📜 /meet-transcript — Retrieve past meeting transcripts
 * Part of the Bits&Bytes Meeting Transcript Agent
 * 
 * Subcommands:
 *   view <meeting-id>  — View a specific transcript
 *   list               — List your accessible meetings
 *   search <query>     — Search meetings by title
 *   delete <meeting-id> — Delete transcript (creator/staff only)
 * 
 * Access Control:
 *   Attendees → can view only their meetings
 *   Creator   → can view + delete their meetings
 *   Staff     → can view + delete any meeting
 */

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const meetingsDb = require('../lib/meetingsDb');
const { isStaff } = require('../lib/auth');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('meet-transcript')
		.setDescription('Retrieve past meeting transcripts and notes')
		.addSubcommand(sub =>
			sub.setName('view')
				.setDescription('View a specific meeting transcript')
				.addStringOption(opt =>
					opt.setName('meeting-id')
						.setDescription('The meeting ID to view')
						.setRequired(true)
				)
		)
		.addSubcommand(sub =>
			sub.setName('list')
				.setDescription('List your recent meetings with transcripts')
		)
		.addSubcommand(sub =>
			sub.setName('search')
				.setDescription('Search meetings by title')
				.addStringOption(opt =>
					opt.setName('query')
						.setDescription('Search term to match meeting titles')
						.setRequired(true)
				)
		)
		.addSubcommand(sub =>
			sub.setName('delete')
				.setDescription('Delete a meeting transcript (creator/staff only)')
				.addStringOption(opt =>
					opt.setName('meeting-id')
						.setDescription('The meeting ID to delete')
						.setRequired(true)
				)
		),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();

		switch (subcommand) {
			case 'view':
				return handleView(interaction);
			case 'list':
				return handleList(interaction);
			case 'search':
				return handleSearch(interaction);
			case 'delete':
				return handleDelete(interaction);
			default:
				return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
		}
	}
};

// ═══════════════════════════════════════════════════
//  VIEW — View a specific transcript
// ═══════════════════════════════════════════════════

async function handleView(interaction) {
	await interaction.deferReply({ ephemeral: true });

	const meetingId = interaction.options.getString('meeting-id');
	const userId = interaction.user.id;
	const guild = interaction.guild;

	try {
		// Access check
		const hasAccess = await checkAccess(userId, meetingId, guild);
		if (!hasAccess) {
			return interaction.editReply({
				content: '🔒 You don\'t have access to this transcript. Only meeting attendees and staff can view it.',
			});
		}

		// Fetch transcript
		const transcript = await meetingsDb.getTranscript(meetingId);
		if (!transcript) {
			return interaction.editReply({
				content: '📭 No transcript found for this meeting. It may not have been recorded or is still processing.',
			});
		}

		// Fetch meeting details
		const meeting = await meetingsDb.getMeeting(meetingId);
		const title = meeting?.title || 'Unknown Meeting';
		const dateStr = meeting?.scheduled_time
			? new Date(meeting.scheduled_time).toLocaleString('en-IN', {
				timeZone: 'Asia/Kolkata',
				day: 'numeric', month: 'short', year: 'numeric',
				hour: 'numeric', minute: '2-digit', hour12: true,
			}) + ' IST'
			: 'Unknown date';

		// Build summary embed
		const embed = new EmbedBuilder()
			.setTitle(`📝 ${title}`)
			.setColor(config.COLORS.primary)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		embed.setDescription(
			`📅 ${dateStr}\n` +
			`🎙️ ${transcript.speaker_count || '?'} speakers • ${Math.round((transcript.audio_duration_seconds || 0) / 60)} min\n` +
			`📋 Processed: ${transcript.processed_at || 'N/A'}`
		);

		if (transcript.summary) {
			embed.addFields({ name: '━━━ Summary ━━━', value: truncate(transcript.summary, 1024), inline: false });
		}

		const decisions = Array.isArray(transcript.key_decisions) ? transcript.key_decisions : [];
		if (decisions.length > 0) {
			embed.addFields({
				name: '━━━ Key Decisions ━━━',
				value: truncate(decisions.map(d => `• ${d}`).join('\n'), 1024),
				inline: false,
			});
		}

		const actions = Array.isArray(transcript.action_items) ? transcript.action_items : [];
		if (actions.length > 0) {
			embed.addFields({
				name: '━━━ Action Items ━━━',
				value: truncate(actions.map(a => {
					const deadline = a.deadline ? ` (by ${a.deadline})` : '';
					return `☐ **${a.assignee}** → ${a.task}${deadline}`;
				}).join('\n'), 1024),
				inline: false,
			});
		}

		const files = [];
		const fullText = transcript.timestamped_transcript || transcript.full_transcript;
		if (fullText) {
			const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
			const fileName = `transcript-${sanitizedTitle}-${meetingId}.txt`;
			files.push(new AttachmentBuilder(Buffer.from(fullText, 'utf-8'), { name: fileName }));
		}

		await interaction.editReply({ embeds: [embed], files });
	} catch (err) {
		console.error(`[MEET-TRANSCRIPT] Error viewing transcript:`, err);
		await interaction.editReply({ content: '❌ An error occurred while fetching the transcript.' });
	}
}

// ═══════════════════════════════════════════════════
//  LIST — List accessible meetings
// ═══════════════════════════════════════════════════

async function handleList(interaction) {
	await interaction.deferReply({ ephemeral: true });

	const userId = interaction.user.id;
	const guild = interaction.guild;

	try {
		let meetings;
		const userIsStaff = isStaff(interaction.member, guild);

		if (userIsStaff) {
			meetings = await meetingsDb.getAllTranscripts({ limit: 20 });
		} else {
			meetings = await meetingsDb.getTranscriptsForUser(userId, { limit: 20 });
		}

		if (!meetings || meetings.length === 0) {
			return interaction.editReply({
				content: '📭 No meeting transcripts found. Meetings you attend will appear here after they are recorded and processed.',
			});
		}

		const embed = new EmbedBuilder()
			.setTitle(`📋 Your Meeting Transcripts`)
			.setColor(config.COLORS.primary)
			.setTimestamp()
			.setFooter({ text: `${config.BRANDING.footerText} • Use /meet-transcript view <id>` });

		if (userIsStaff) {
			embed.setDescription('🛡️ Staff view — showing all meetings');
		}

		const lines = meetings.map(m => {
			const date = new Date(m.scheduled_time).toLocaleDateString('en-IN', {
				timeZone: 'Asia/Kolkata',
				day: 'numeric', month: 'short',
			});
			const duration = m.audio_duration_seconds
				? `${Math.round(m.audio_duration_seconds / 60)}min`
				: '?';
			return `**${m.title}** — ${date} • ${duration} • \`${m.id}\``;
		});

		embed.addFields({
			name: `${meetings.length} transcript(s)`,
			value: truncate(lines.join('\n'), 1024),
			inline: false,
		});

		await interaction.editReply({ embeds: [embed] });
	} catch (err) {
		console.error(`[MEET-TRANSCRIPT] Error listing transcripts:`, err);
		await interaction.editReply({ content: '❌ An error occurred while fetching your transcripts.' });
	}
}

// ═══════════════════════════════════════════════════
//  SEARCH — Search by title
// ═══════════════════════════════════════════════════

async function handleSearch(interaction) {
	await interaction.deferReply({ ephemeral: true });

	const query = interaction.options.getString('query');
	const userId = interaction.user.id;
	const guild = interaction.guild;

	try {
		let meetings;
		const userIsStaff = isStaff(interaction.member, guild);

		if (userIsStaff) {
			meetings = await meetingsDb.getAllTranscripts({ search: query, limit: 20 });
		} else {
			meetings = await meetingsDb.getTranscriptsForUser(userId, { search: query, limit: 20 });
		}

		if (!meetings || meetings.length === 0) {
			return interaction.editReply({
				content: `📭 No transcripts found matching "${query}".`,
			});
		}

		const embed = new EmbedBuilder()
			.setTitle(`🔍 Search Results: "${query}"`)
			.setColor(config.COLORS.primary)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		const lines = meetings.map(m => {
			const date = new Date(m.scheduled_time).toLocaleDateString('en-IN', {
				timeZone: 'Asia/Kolkata',
				day: 'numeric', month: 'short',
			});
			return `**${m.title}** — ${date} • \`${m.id}\``;
		});

		embed.addFields({
			name: `${meetings.length} result(s)`,
			value: truncate(lines.join('\n'), 1024),
			inline: false,
		});

		await interaction.editReply({ embeds: [embed] });
	} catch (err) {
		console.error(`[MEET-TRANSCRIPT] Error searching transcripts:`, err);
		await interaction.editReply({ content: '❌ An error occurred while searching.' });
	}
}

// ═══════════════════════════════════════════════════
//  DELETE — Delete a transcript (creator/staff only)
// ═══════════════════════════════════════════════════

async function handleDelete(interaction) {
	await interaction.deferReply({ ephemeral: true });

	const meetingId = interaction.options.getString('meeting-id');
	const userId = interaction.user.id;
	const guild = interaction.guild;

	try {
		const meeting = await meetingsDb.getMeeting(meetingId);
		if (!meeting) {
			return interaction.editReply({ content: '❌ Meeting not found.' });
		}

		const userIsStaff = isStaff(interaction.member, guild);
		const isCreator = meeting.creator_id === userId;

		if (!userIsStaff && !isCreator) {
			return interaction.editReply({
				content: '🔒 Only the meeting creator or staff can delete transcripts.',
			});
		}

		const transcript = await meetingsDb.getTranscript(meetingId);
		if (!transcript) {
			return interaction.editReply({ content: '📭 No transcript found for this meeting.' });
		}

		const confirmId = `confirm_delete_${meetingId}_${Date.now()}`;
		const cancelId = `cancel_delete_${meetingId}_${Date.now()}`;

		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(confirmId)
				.setLabel('Yes, delete it')
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId(cancelId)
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Secondary)
		);

		const response = await interaction.editReply({
			content: `⚠️ **Are you sure you want to delete the transcript for "${meeting.title}"?** This cannot be undone.`,
			components: [row]
		});

		const filter = i => (i.customId === confirmId || i.customId === cancelId) && i.user.id === userId;
		try {
			const confirmation = await response.awaitMessageComponent({ filter, time: 30000 });
			
			if (confirmation.customId === confirmId) {
				await meetingsDb.deleteTranscript(meetingId);
				await confirmation.update({
					content: `🗑️ Transcript for **"${meeting.title}"** has been deleted successfully.`,
					components: []
				});
			} else {
				await confirmation.update({
					content: `❌ Deletion cancelled. Transcript was not deleted.`,
					components: []
				});
			}
		} catch (e) {
			// Timeout or error
			await interaction.editReply({
				content: `⏱️ Deletion request timed out. No changes were made.`,
				components: []
			});
		}
	} catch (err) {
		console.error(`[MEET-TRANSCRIPT] Error deleting transcript:`, err);
		await interaction.editReply({ content: '❌ An error occurred while deleting the transcript.' });
	}
}

// ═══════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════

async function checkAccess(userId, meetingId, guild) {
	try {
		const member = await guild.members.fetch(userId).catch(() => null);
		if (member && isStaff(member, guild)) {
			return true;
		}
	} catch { /* ignore */ }

	const meeting = await meetingsDb.getMeeting(meetingId);
	if (meeting && meeting.creator_id === userId) {
		return true;
	}

	return await meetingsDb.isUserAttendee(meetingId, userId);
}

function truncate(str, max) {
	if (!str) return '';
	if (str.length <= max) return str;
	return str.substring(0, max - 3) + '...';
}
