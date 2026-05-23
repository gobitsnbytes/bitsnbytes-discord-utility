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
		const allowedRoles = ['1506019068132462804', '1506323726223016149', '1480620981587279993'];
		const executingMember = await interaction.guild.members.fetch(interaction.user.id);
		
		const isAuthorized = allowedRoles.some(roleId => executingMember.roles.cache.has(roleId)) || executingMember.permissions.has('Administrator');
		
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
			const forkLeadRole = guild.roles.cache.find(r => r.name === 'fork-lead');
			if (!forkLeadRole) throw new Error('@fork-lead role not found in server.');
			
			const member = await guild.members.fetch(user.id);
			await member.roles.add(forkLeadRole);

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

			const STAFF_ROLE_ID = '1480620981587279993';
			const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);
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
				)
				.setColor(config.COLORS.success)
				.setThumbnail(interaction.guild.iconURL())
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			await interaction.editReply({ embeds: [successEmbed] });

			// Announce new fork to announcements channel
			try {
				const announcementChannel = await guild.channels.fetch('1490415427409412376');
				if (announcementChannel) {
					await announcementChannel.send(`**Bits&Bytes ${city}** is now live! Force-onboarded lead: <@${user.id}>`);
				}
			} catch (error) {
				console.warn('[ADMIN_ADD_LEAD] Announcement fail:', error.message);
			}

		} catch (error) {
			console.error('[ADMIN_ADD_LEAD_ERROR]', error);
			const logger = require('../lib/logger');
			logger.error('Failed to force-onboard fork lead', error);
			await interaction.editReply(`❌ There was an error while force-onboarding the fork lead: **${error.message}**`);
		}
	}
};
