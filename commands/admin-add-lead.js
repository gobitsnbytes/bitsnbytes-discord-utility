const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');
const { isStaff, getStaffRole, getForkLeadRole } = require('../lib/auth');
const { setupOnboardingRoles, setupOnboardingChannel } = require('../lib/onboardingHelper');
const { syncForkPermissions } = require('../lib/channelSync');
const logger = require('../lib/logger');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('admin-add-lead')
		.setDescription('Admin command: Directly onboard a new fork lead bypassing request flow.')
		.addUserOption(option => option.setName('user').setDescription('The user to onboard').setRequired(true))
		.addStringOption(option => option.setName('city').setDescription('The city for the fork').setRequired(true)),

	async execute(interaction) {
		const executingMember = await interaction.guild.members.fetch(interaction.user.id);
		
		const isAuthorized = isStaff(executingMember, interaction.guild);
		
		if (!isAuthorized) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.error} PROTOCOL_UNAUTHORIZED`)
				.setDescription('Your credentials do not grant access to run administrative onboarding.')
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			return await interaction.reply({ 
				embeds: [unauthorizedEmbed], 
				flags: [MessageFlags.Ephemeral] 
			});
		}

		const user = interaction.options.getUser('user');
		const city = interaction.options.getString('city');
		const guild = interaction.guild;

		const flags = config.PRIVACY.merge ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			const member = await guild.members.fetch(user.id);
			
			// 1. Assign roles using onboarding helper
			const { roleAssigned, contributorCityRole } = await setupOnboardingRoles(guild, member, city);

			// 2. Check Notion database
			const fork = await notion.findForkByCity(city);
			let notionStatus = 'synchronized';

			if (fork) {
				// User already has a Notion page, activate it
				await notion.updateForkStatus(fork.id, 'Active', user.id);
			} else {
				// User was directly added, track pending Notion profile in SQLite
				await meetingsDb.addPendingProfile(user.id, city);
				notionStatus = 'pending_registration';

				// Send DM request to fill out Notion profile
				try {
					const registrationUrl = 'https://perfect-dinghy-781.notion.site/33a49ed2fc33800984e7c28ca3d7cd2a?pvs=105';
					await user.send(
						`👋 **Welcome to the Bits&Bytes network!**\n\n` +
						`An administrator has directly onboarded you as the **Fork Lead** for **${city}**.\n` +
						`To complete your onboarding, please fill out the Notion registration form: ${registrationUrl}\n\n` +
						`*Note: The bot will check daily and remind you until your registration is complete.*`
					).catch(() => {});
				} catch (dmErr) {
					console.warn(`[ADMIN_ADD_LEAD] Could not send DM to user ${user.id}:`, dmErr.message);
				}
			}

			// 3. Create/Setup City Channel using onboarding helper
			const { channel, channelName } = await setupOnboardingChannel(guild, user, city, contributorCityRole);

			const successEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} ADMIN_FORCE_MERGE // DIRECT_ONBOARD`)
				.setDescription(`Direct onboarding complete. Target: **<@${user.id}>**.`)
				.addFields(
					{ name: '⌬ LOCATION', value: `\`${city.toUpperCase()}\``, inline: true },
					{ name: '⌬ CHANNEL', value: `\`${channelName.toUpperCase()}\``, inline: true },
					{ name: '📋 NOTION SYNC', value: notionStatus === 'synchronized' ? '✅ ACTIVE (Synchronized)' : '⚠️ PENDING (User notified to register)', inline: false }
				);

			if (!roleAssigned) {
				successEmbed.addFields({ name: 'Warning: Role Assignment', value: `The bot could not assign the **@fork-lead** role automatically because the bot's highest role is below the **@fork-lead** role in the server settings hierarchy. Please assign the role to <@${user.id}> manually.`, inline: false });
			}

			successEmbed.setColor(config.COLORS.success)
				.setThumbnail(interaction.guild.iconURL())
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			await interaction.editReply({ embeds: [successEmbed] });

			// Announce new fork to announcements channel
			try {
				const announcementChannel = await guild.channels.fetch(config.CHANNEL_IDS.announcement);
				if (announcementChannel) {
					const capitalizedCity = city.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
					await announcementChannel.send(`**Bits&Bytes ${capitalizedCity}** is now live! Appointed lead: <@${user.id}> 🎉`);
				}
			} catch (error) {
				console.warn('[ADMIN_ADD_LEAD] Announcement fail:', error.message);
			}

			// 4. Trigger self-healing permissions sync immediately
			try {
				const updatedFork = await notion.findForkByCity(city);
				if (updatedFork) {
					await syncForkPermissions(guild.client, updatedFork);
				}
			} catch (syncErr) {
				console.warn('[ADMIN_ADD_LEAD] Permission sync fail:', syncErr.message);
			}

		} catch (error) {
			console.error('[ADMIN_ADD_LEAD_ERROR]', error);
			logger.error('Failed to force-onboard fork lead', error);
			await interaction.editReply(`❌ There was an error while force-onboarding the fork lead: **${error.message}**`);
		}
	}
};
