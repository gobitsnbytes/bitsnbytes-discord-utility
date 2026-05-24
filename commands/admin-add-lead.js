const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const meetingsDb = require('../lib/meetingsDb');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('admin-add-lead')
		.setDescription('Admin command: Directly onboard a new fork lead bypassing request flow.')
		.addUserOption(option => option.setName('user').setDescription('The user to onboard').setRequired(true))
		.addStringOption(option => option.setName('city').setDescription('The city for the fork').setRequired(true)),

	async execute(interaction) {
		const { isStaff, getStaffRole, getForkLeadRole } = require('../lib/auth');
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
			// 1. Assign @fork-lead role
			const forkLeadRole = getForkLeadRole(guild);
			if (!forkLeadRole) throw new Error('@fork-lead role not found in server.');
			
			const member = await guild.members.fetch(user.id);
			let roleAssigned = true;
			try {
				await member.roles.add(forkLeadRole);
			} catch (roleErr) {
				console.error('[ADMIN_ADD_LEAD] Failed to assign role (hierarchy/permissions check):', roleErr.message);
				roleAssigned = false;
			}

			// Resolve or create city role
			let cityRole = guild.roles.cache.find(r => r.name.toLowerCase() === city.toLowerCase());
			if (!cityRole) {
				try {
					cityRole = await guild.roles.create({
						name: city,
						reason: 'Direct onboard city role creation'
					});
				} catch (err) {
					console.error(`[ADMIN_ADD_LEAD] Failed to create city role "${city}":`, err.message);
				}
			}
			if (cityRole) {
				try {
					await member.roles.add(cityRole);
				} catch (roleErr) {
					console.error(`[ADMIN_ADD_LEAD] Failed to assign city role (${city}):`, roleErr.message);
					roleAssigned = false;
				}
			}

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

			// 3. Create/Setup City Channel
			const category = guild.channels.cache.find(c => c.name === 'FORKS' && c.type === ChannelType.GuildCategory);
			const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;
			
			const overwrites = [
				{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
				{ id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
			];

			const staffRole = getStaffRole(guild);
			if (staffRole) {
				overwrites.push({
					id: staffRole.id,
					allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
				});
			}

			let channel = guild.channels.cache.find(c => c.name === channelName);
			if (!channel) {
				channel = await guild.channels.create({
					name: channelName,
					type: ChannelType.GuildText,
					parent: category ? category.id : null,
					permissionOverwrites: overwrites
				});
			} else {
				await channel.permissionOverwrites.set(overwrites);
			}

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
				const announcementChannel = await guild.channels.fetch('1490415427409412376');
				if (announcementChannel) {
					const capitalizedCity = city.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
					await announcementChannel.send(`**Bits&Bytes ${capitalizedCity}** is now live! Appointed lead: <@${user.id}> 🎉`);
				}
			} catch (error) {
				console.warn('[ADMIN_ADD_LEAD] Announcement fail:', error.message);
			}

			// 4. Trigger self-healing permissions sync immediately
			try {
				const { syncForkPermissions } = require('../lib/channelSync');
				const updatedFork = await notion.findForkByCity(city);
				if (updatedFork) {
					await syncForkPermissions(guild.client, updatedFork);
				}
			} catch (syncErr) {
				console.warn('[ADMIN_ADD_LEAD] Permission sync fail:', syncErr.message);
			}

		} catch (error) {
			console.error('[ADMIN_ADD_LEAD_ERROR]', error);
			const logger = require('../lib/logger');
			logger.error('Failed to force-onboard fork lead', error);
			await interaction.editReply(`❌ There was an error while force-onboarding the fork lead: **${error.message}**`);
		}
	}
};
