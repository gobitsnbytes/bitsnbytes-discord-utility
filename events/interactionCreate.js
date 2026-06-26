const { Events, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const logger = require('../lib/logger');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (interaction.isChatInputCommand()) {
			const command = interaction.client.commands.get(interaction.commandName);

			if (!command) {
				logger.error(`No command matching ${interaction.commandName} was found.`);
				return;
			}

			try {
				await command.execute(interaction);
				// Check if the command already replied/deferred and if it's considered a success
				// If the command caught its own error and edited the reply, it might still reach here.
				// We'll trust the command.execute to throw if it's a true failure.
				if (!command.noLog) {
					logger.command(interaction, 'SUCCESS');
				}
			} catch (error) {
				// Don't log "Interaction has already been acknowledged" or "Unknown interaction" as a command error if it's just a duplicate process
				if (error.code == 40060 || error.code == 10062) {
					logger.warn(`Interaction already acknowledged/unknown (likely duplicate process): ${interaction.commandName}`);
					return;
				}

				if (!command.noLog) {
					logger.command(interaction, 'ERROR', error);
				}
				
				const errorEmbed = new EmbedBuilder()
					.setTitle(`${config.EMOJIS.error} Protocol Breach`)
					.setDescription(error.message || 'A system error has occurred during synchronization.')
					.setColor(config.COLORS.error)
					.setFooter({ text: config.BRANDING.footerText });
				
				try {
					if (!interaction.isRepliable()) return;

					if (interaction.replied || interaction.deferred) {
						await interaction.editReply({ embeds: [errorEmbed], content: null }).catch(() => {
							// If editReply fails, try followUp as a last resort
							return interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => null);
						});
					} else {
						await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] }).catch(() => null);
					}
				} catch (innerError) {
					logger.error('Critical: Could not send error response to user', innerError);
				}
			}
		} else if (interaction.isAutocomplete()) {
			const command = interaction.client.commands.get(interaction.commandName);

			if (!command) {
				console.error(`No command matching ${interaction.commandName} was found for autocomplete.`);
				return;
			}

			try {
				await command.autocomplete(interaction);
			} catch (error) {
				console.error('[AUTOCOMPLETE_ERROR]', error);
			}
		} else if (interaction.isModalSubmit()) {
			// Handle Modal Submissions if any (future use)
		} else if (interaction.isButton()) {
			if (interaction.customId === 'refresh_forks_info') {
				const command = interaction.client.commands.get('forks-info');
				if (command && typeof command.handleButton === 'function') {
					try {
						await command.handleButton(interaction);
					} catch (error) {
						console.error('[BUTTON_ERROR] Failed to handle refresh button:', error);
						await interaction.reply({ content: `❌ Failed to refresh topology data: ${error.message}`, flags: [MessageFlags.Ephemeral] }).catch(() => null);
					}
				}
			} else if (interaction.customId.startsWith('consent_hindi_')) {
				// Hindi consent translation button — from meeting recording notice
				try {
					const { handleConsentButton } = require('../lib/voiceRecorder');
					await handleConsentButton(interaction);
				} catch (error) {
					console.error('[BUTTON_ERROR] Failed to handle consent button:', error);
					await interaction.reply({ content: '❌ Could not load Hindi translation.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
				}
			} else if (interaction.customId.startsWith('accept_instant_')) {
				const meetingId = interaction.customId.replace('accept_instant_', '');
				try {
					await interaction.deferUpdate();
					const meetingsDb = require('../lib/meetingsDb');
					const meetingsHelper = require('../lib/meetingsHelper');
					const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
					const { getEventsChannel } = require('../lib/calcomWebhook');

					const meeting = await meetingsDb.getMeeting(meetingId);
					if (!meeting) {
						return await interaction.followUp({ content: '❌ Meeting request not found in database.', flags: [MessageFlags.Ephemeral] });
					}
					if (meeting.status !== 'pending') {
						return await interaction.followUp({ content: `❌ Meeting request is already processed (Status: ${meeting.status}).`, flags: [MessageFlags.Ephemeral] });
					}

					// Atomic: only one button click wins across processes
					if (!(await meetingsDb.tryClaimReminder(meetingId, 'instant_processed'))) {
						return await interaction.followUp({ content: '❌ Meeting request is already processed.', flags: [MessageFlags.Ephemeral] });
					}

					// Update status to active
					await meetingsDb.updateMeetingStatus(meetingId, 'active');

					// Provision Voice Channel
					const guild = interaction.client.guilds.cache.first();
					let vcChannel = null;
					let vcLink = '';
					if (guild) {
						vcChannel = await meetingsHelper.createMeetingVoiceChannel(guild, meeting);
						if (vcChannel) {
							meeting.temp_channel_id = vcChannel.id;
							vcLink = `https://discord.com/channels/${guild.id}/${vcChannel.id}`;
							await meetingsDb.setTempChannelId(meetingId, vcChannel.id);
						}
					}

					// Update the DM message with disabled buttons showing accepted status
					const acceptedRow = new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId(`accept_instant_${meetingId}`)
							.setLabel('Accepted')
							.setStyle(ButtonStyle.Success)
							.setDisabled(true)
							.setEmoji('🟢'),
						new ButtonBuilder()
							.setCustomId(`decline_instant_${meetingId}`)
							.setLabel('Decline')
							.setStyle(ButtonStyle.Danger)
							.setDisabled(true)
					);

					const originalEmbed = interaction.message.embeds[0];
					const updatedEmbed = EmbedBuilder.from(originalEmbed)
						.setTitle(`⚡ INSTANT_MEET_REQUEST // ACCEPTED`)
						.setColor(config.COLORS.success)
						.setFooter({ text: 'Meeting has been successfully scheduled and started.' });

					if (vcLink) {
						updatedEmbed.addFields({ name: '🔊 VOICE CHANNEL', value: `[Join Voice Channel](${vcLink})` });
					}

					await interaction.editReply({
						content: `✅ **You accepted the meeting request**:`,
						embeds: [updatedEmbed],
						components: [acceptedRow]
					}).catch(() => {});

					// Post to events channel & send DMs/emails
					if (guild) {
						// Send DMs to other invitees if any
						await meetingsHelper.sendMeetingDMs(guild, meeting, vcLink);
						// Send emails
						await meetingsHelper.sendMeetingEmails(guild, meeting, 'invite');

						// Post commencement
						const eventsChannel = await getEventsChannel(guild);
						if (eventsChannel) {
							const tags = meeting.attendees.map(a => a.type === 'user' ? `<@${a.discordId}>` : `<@&${a.discordId}>`).join(' ');
							const eventEmbed = new EmbedBuilder()
								.setTitle(`⚛️ INSTANT_MEETING_COMMENCEMENT // LIVE`)
								.setDescription(`An instant sync session "**${meeting.title}**" has been accepted and is starting now!`)
								.setColor(config.COLORS.primary)
								.addFields(
									{ name: '📋 TITLE', value: meeting.title, inline: false },
									{ name: '👥 INVITEES', value: tags || 'None', inline: true },
									{ name: '🔐 VC ACCESS', value: `\`${meeting.scope || 'invite'}\``, inline: true }
								)
								.setTimestamp()
								.setFooter({ text: config.BRANDING.footerText });

							if (vcLink) {
								eventEmbed.addFields({ name: '🔊 JOIN VC NOW', value: `[Click here to connect](${vcLink})`, inline: false });
							}
							await eventsChannel.send({
								content: `🔔 **Instant Meeting Starting Now**: ${tags}`,
								embeds: [eventEmbed]
							});
						}
					}
				} catch (err) {
					console.error('[BUTTON_ACCEPT_ERROR]', err);
					await interaction.followUp({ content: '❌ System failure while accepting meeting.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
				}
			} else if (interaction.customId.startsWith('decline_instant_')) {
				const meetingId = interaction.customId.replace('decline_instant_', '');
				try {
					await interaction.deferUpdate();
					const meetingsDb = require('../lib/meetingsDb');
					const meetingsHelper = require('../lib/meetingsHelper');
					const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

					const meeting = await meetingsDb.getMeeting(meetingId);
					if (!meeting) {
						return await interaction.followUp({ content: '❌ Meeting request not found in database.', flags: [MessageFlags.Ephemeral] });
					}
					if (meeting.status !== 'pending') {
						return await interaction.followUp({ content: `❌ Meeting request is already processed (Status: ${meeting.status}).`, flags: [MessageFlags.Ephemeral] });
					}

					// Atomic: only one button click wins across processes
					if (!(await meetingsDb.tryClaimReminder(meetingId, 'instant_processed'))) {
						return await interaction.followUp({ content: '❌ Meeting request is already processed.', flags: [MessageFlags.Ephemeral] });
					}

					// Update status to cancelled
					await meetingsDb.updateMeetingStatus(meetingId, 'cancelled');

					// Update the DM message with disabled buttons showing declined status
					const declinedRow = new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId(`accept_instant_${meetingId}`)
							.setLabel('Accept Sync Request')
							.setStyle(ButtonStyle.Success)
							.setDisabled(true),
						new ButtonBuilder()
							.setCustomId(`decline_instant_${meetingId}`)
							.setLabel('Declined')
							.setStyle(ButtonStyle.Danger)
							.setDisabled(true)
							.setEmoji('🔴')
					);

					const originalEmbed = interaction.message.embeds[0];
					const updatedEmbed = EmbedBuilder.from(originalEmbed)
						.setTitle(`⚡ INSTANT_MEET_REQUEST // DECLINED`)
						.setColor(config.COLORS.error)
						.setFooter({ text: 'Meeting sync request was declined.' });

					await interaction.editReply({
						content: `❌ **You declined the meeting request**:`,
						embeds: [updatedEmbed],
						components: [declinedRow]
					}).catch(() => {});

					// Send cancellation email if emails are present
					const guild = interaction.client.guilds.cache.first();
					if (guild) {
						await meetingsHelper.sendMeetingEmails(guild, meeting, 'cancel');
					}
				} catch (err) {
					console.error('[BUTTON_DECLINE_ERROR]', err);
					await interaction.followUp({ content: '❌ System failure while declining meeting.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
				}
			} else if (interaction.customId.startsWith('action_item_complete_') || interaction.customId.startsWith('action_item_dismiss_')) {
				const isComplete = interaction.customId.startsWith('action_item_complete_');
				const actionItemId = interaction.customId.replace('action_item_complete_', '').replace('action_item_dismiss_', '');
				try {
					await interaction.deferUpdate();
					const meetingsDb = require('../lib/meetingsDb');
					const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

					const actionItem = await meetingsDb.getActionItem(actionItemId);
					if (!actionItem) {
						return await interaction.followUp({ content: '❌ Action item not found.', flags: [MessageFlags.Ephemeral] });
					}

					// Verify authorization (only the assigned user can update it)
					if (actionItem.discord_id && interaction.user.id !== actionItem.discord_id) {
						return await interaction.followUp({ content: '❌ You are not authorized to update this action item.', flags: [MessageFlags.Ephemeral] });
					}

					const newStatus = isComplete ? 'completed' : 'dismissed';
					await meetingsDb.updateActionItemStatus(actionItemId, newStatus);

					// Get original embed
					const originalEmbed = interaction.message.embeds[0];
					if (!originalEmbed) {
						return await interaction.followUp({ content: '❌ Original message content is missing.', flags: [MessageFlags.Ephemeral] });
					}

					const updatedEmbed = EmbedBuilder.from(originalEmbed);
					
					let completedRow;
					if (isComplete) {
						updatedEmbed
							.setTitle(`✅ ACTION_ITEM_COMPLETED`)
							.setColor(config.COLORS.success)
							.setDescription(originalEmbed.description + `\n\n**Status:** Completed`);
						
						completedRow = new ActionRowBuilder().addComponents(
							new ButtonBuilder()
								.setCustomId(`action_item_complete_${actionItemId}`)
								.setLabel('Completed')
								.setStyle(ButtonStyle.Success)
								.setDisabled(true)
								.setEmoji('🟢'),
							new ButtonBuilder()
								.setCustomId(`action_item_dismiss_${actionItemId}`)
								.setLabel('Dismiss')
								.setStyle(ButtonStyle.Secondary)
								.setDisabled(true)
						);
					} else {
						updatedEmbed
							.setTitle(`❌ ACTION_ITEM_DISMISSED`)
							.setColor(config.COLORS.error)
							.setDescription(originalEmbed.description + `\n\n**Status:** Dismissed`);
						
						completedRow = new ActionRowBuilder().addComponents(
							new ButtonBuilder()
								.setCustomId(`action_item_complete_${actionItemId}`)
								.setLabel('Mark Completed')
								.setStyle(ButtonStyle.Success)
								.setDisabled(true),
							new ButtonBuilder()
								.setCustomId(`action_item_dismiss_${actionItemId}`)
								.setLabel('Dismissed')
								.setStyle(ButtonStyle.Secondary)
								.setDisabled(true)
								.setEmoji('🔴')
						);
					}

					await interaction.editReply({
						embeds: [updatedEmbed],
						components: [completedRow]
					}).catch(() => {});
				} catch (err) {
					console.error('[ACTION_ITEM_BUTTON_ERROR]', err);
					await interaction.followUp({ content: '❌ System failure while updating action item.', flags: [MessageFlags.Ephemeral] }).catch(() => null);
				}
			}
		}
	},
};
