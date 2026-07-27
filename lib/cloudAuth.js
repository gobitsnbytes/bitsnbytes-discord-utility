const { 
	EmbedBuilder, 
	ActionRowBuilder, 
	ButtonBuilder, 
	ButtonStyle, 
	ModalBuilder, 
	TextInputBuilder, 
	TextInputStyle, 
	StringSelectMenuBuilder, 
	MessageFlags 
} = require('discord.js');
const config = require('../config');
const logger = require('./logger');

const MOTHERBOARD_API_URL = process.env.MOTHERBOARD_API_URL || 'http://localhost:8000';
const API_INTERNAL_SECRET = process.env.API_INTERNAL_SECRET || '';

/**
 * Parses applicant metadata from Discord embed fields
 */
function parseApplicantFromEmbed(embed) {
	if (!embed || !embed.fields) return { name: 'Applicant', email: '' };

	let name = 'Applicant';
	let email = '';

	for (const field of embed.fields) {
		const fieldName = (field.name || '').toLowerCase();
		if (fieldName.includes('name')) {
			name = field.value;
		} else if (fieldName.includes('email')) {
			email = field.value;
		}
	}

	return { name, email };
}

/**
 * Dispatches decision payload to Motherboard API endpoint
 */
async function callMotherboardDecisionApi(action, email, name, reason, reviewer) {
	const endpoint = `${MOTHERBOARD_API_URL}/api/cloud/send-decision`;
	
	const headers = {
		'Content-Type': 'application/json',
	};
	if (API_INTERNAL_SECRET) {
		headers['X-API-Secret'] = API_INTERNAL_SECRET;
	}

	const response = await fetch(endpoint, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			action,
			email,
			name,
			reason,
			reviewer,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Motherboard API error (${response.status}): ${text}`);
	}

	return await response.json();
}

/**
 * Core processor for updating Discord Embed and triggering Motherboard email send
 */
async function processCloudDecision(interaction, action, reason, targetMessage) {
	const msg = targetMessage || interaction.message;
	if (!msg || !msg.embeds || !msg.embeds[0]) {
		throw new Error('Original application embed message not found.');
	}

	const originalEmbed = msg.embeds[0];
	const { name, email } = parseApplicantFromEmbed(originalEmbed);

	if (!email) {
		throw new Error('Could not find applicant email address in the Discord embed.');
	}

	const reviewerTag = interaction.user.tag || interaction.user.username;
	const formattedReason = reason || (action === 'approve' ? 'Approved — Welcome to SparkCloud!' : 'Application requirements not met.');

	// 1. Send decision email via Motherboard
	await callMotherboardDecisionApi(action, email, name, formattedReason, reviewerTag);

	// 2. Build updated embed
	const isApprove = action === 'approve';
	const updatedEmbed = EmbedBuilder.from(originalEmbed)
		.setTitle(isApprove ? '✅ SPARKCLOUD ACCESS // APPROVED' : '❌ SPARKCLOUD ACCESS // DENIED')
		.setColor(isApprove ? config.COLORS.success : config.COLORS.error)
		.setFooter({ text: `Processed by @${interaction.user.username} • bits&bytes™ Anti-Abuse System` });

	// Update or add Status and Reason fields
	const newFields = originalEmbed.fields.filter(f => !f.name.includes('Status') && !f.name.includes('Reason') && !f.name.includes('Note'));
	newFields.push({
		name: '📌 Review Status',
		value: isApprove ? `\`APPROVED\` by <@${interaction.user.id}>` : `\`DENIED\` by <@${interaction.user.id}>`,
		inline: true,
	});
	newFields.push({
		name: isApprove ? '💬 Reviewer Note' : '💬 Rejection Reason',
		value: formattedReason,
		inline: false,
	});

	updatedEmbed.setFields(newFields);

	// 3. Disable action buttons on original message
	const disabledRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId('cloud_approve')
			.setLabel('Approved')
			.setStyle(ButtonStyle.Success)
			.setDisabled(true)
			.setEmoji(isApprove ? '✅' : '✔'),
		new ButtonBuilder()
			.setCustomId('cloud_deny')
			.setLabel('Denied')
			.setStyle(ButtonStyle.Danger)
			.setDisabled(true)
			.setEmoji(!isApprove ? '❌' : '✖')
	);

	await msg.edit({
		embeds: [updatedEmbed],
		components: [disabledRow],
	});

	const responseText = isApprove 
		? `✅ **Approved!** Confirmation email with access link sent to \`${email}\`.`
		: `❌ **Denied.** Rejection notification email sent to \`${email}\`.`;

	if (interaction.replied || interaction.deferred) {
		await interaction.followUp({ content: responseText, ephemeral: true }).catch(() => null);
	} else {
		await interaction.reply({ content: responseText, ephemeral: true }).catch(() => null);
	}
}

/**
 * Button click handler for 'Approve Access'
 */
async function handleCloudApproveButton(interaction) {
	const modal = new ModalBuilder()
		.setCustomId('cloud_approve_modal')
		.setTitle('Approve SparkCloud Access');

	const noteInput = new TextInputBuilder()
		.setCustomId('approve_reason')
		.setLabel('Approval Note (Optional)')
		.setStyle(TextInputStyle.Paragraph)
		.setValue('Your SparkCloud access request has been approved! Welcome to SparkCloud.')
		.setRequired(false)
		.setMaxLength(500);

	const row = new ActionRowBuilder().addComponents(noteInput);
	modal.addComponents(row);

	await interaction.showModal(modal);
}

const REJECTION_BOILERPLATES = {
	invalid_id: 'The uploaded ID or School ID document was unreadable, blurry, or invalid. Please re-apply with a clear document photo.',
	incomplete_github: 'Your GitHub profile is incomplete, inactive, or could not be verified.',
	incomplete_linkedin: 'Your LinkedIn profile is incomplete or could not be verified.',
	age_restriction: 'SparkCloud access via bits&bytes is strictly reserved for students aged 13-19.',
	residency_restriction: 'SparkCloud access via this program is limited to Indian residents.',
};

/**
 * Button click handler for 'Deny Access'
 */
async function handleCloudDenyButton(interaction) {
	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId('cloud_deny_select')
		.setPlaceholder('Select Rejection Reason / Boilerplate...')
		.addOptions([
			{
				label: 'Invalid / Unreadable ID Document',
				description: 'Photo was blurry, cropped, or invalid ID',
				value: 'invalid_id',
				emoji: '📄',
			},
			{
				label: 'Incomplete / Unverifiable GitHub Profile',
				description: 'GitHub profile was empty or could not be verified',
				value: 'incomplete_github',
				emoji: '🐙',
			},
			{
				label: 'Incomplete / Unverifiable LinkedIn Profile',
				description: 'LinkedIn profile was incomplete or invalid',
				value: 'incomplete_linkedin',
				emoji: '💼',
			},
			{
				label: 'Age Requirement Not Met (13–19)',
				description: 'Applicant is outside the 13-19 age bracket',
				value: 'age_restriction',
				emoji: '⚠️',
			},
			{
				label: 'Residency Requirement Not Met (India)',
				description: 'Applicant is not an Indian resident',
				value: 'residency_restriction',
				emoji: '🌐',
			},
			{
				label: 'Custom Reason (Type Manually)',
				description: 'Open modal to type a custom denial reason',
				value: 'CUSTOM_REASON_MODAL',
				emoji: '✏️',
			},
		]);

	const row = new ActionRowBuilder().addComponents(selectMenu);

	await interaction.reply({
		content: '⚠️ **Select Rejection Reason:** Choose a pre-filled boilerplate or type a custom reason below.',
		components: [row],
		ephemeral: true,
	});
}

/**
 * Select menu handler for denial reason selection
 */
async function handleCloudDenySelect(interaction) {
	const selectedValue = interaction.values[0];

	if (selectedValue === 'CUSTOM_REASON_MODAL') {
		const modal = new ModalBuilder()
			.setCustomId('cloud_deny_modal')
			.setTitle('Deny Access - Custom Reason');

		const reasonInput = new TextInputBuilder()
			.setCustomId('deny_reason')
			.setLabel('Reason for Rejection')
			.setStyle(TextInputStyle.Paragraph)
			.setPlaceholder('Type custom feedback for the applicant...')
			.setRequired(true)
			.setMaxLength(500);

		const row = new ActionRowBuilder().addComponents(reasonInput);
		modal.addComponents(row);

		await interaction.showModal(modal);
		return;
	}

	const reasonText = REJECTION_BOILERPLATES[selectedValue] || selectedValue;

	await interaction.deferUpdate();
	const targetMessage = interaction.message.reference ? await interaction.channel.messages.fetch(interaction.message.reference.messageId).catch(() => null) : interaction.message;
	
	// If interaction.message is the ephemeral select menu message, targetMessage is the original message
	const channelMessage = targetMessage || interaction.channel.messages.cache.first();

	try {
		await processCloudDecision(interaction, 'deny', reasonText, channelMessage);
	} catch (error) {
		logger.error('[CLOUD_AUTH] Rejection process error:', error);
		await interaction.followUp({ content: `❌ Error processing rejection: ${error.message}`, ephemeral: true }).catch(() => null);
	}
}


/**
 * Modal submission handler
 */
async function handleCloudModalSubmit(interaction) {
	await interaction.deferReply({ ephemeral: true });

	const customId = interaction.customId;
	const isApprove = customId === 'cloud_approve_modal';
	const inputId = isApprove ? 'approve_reason' : 'deny_reason';
	const reason = interaction.fields.getTextInputValue(inputId);

	// Original message where button was clicked
	const targetMessage = interaction.message;

	try {
		await processCloudDecision(interaction, isApprove ? 'approve' : 'deny', reason, targetMessage);
	} catch (error) {
		logger.error('[CLOUD_AUTH] Modal decision error:', error);
		await interaction.editReply({ content: `❌ Error processing decision: ${error.message}` }).catch(() => null);
	}
}

module.exports = {
	handleCloudApproveButton,
	handleCloudDenyButton,
	handleCloudDenySelect,
	handleCloudModalSubmit,
	processCloudDecision,
};
