const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
const { getForkLeadRole, getStaffRole } = require('../lib/auth');
const { setupOnboardingRoles, setupOnboardingChannel } = require('../lib/onboardingHelper');
const { syncForkPermissions } = require('../lib/channelSync');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('merge')
		.setDescription('Officially onboard a new fork lead.')
		.addUserOption(option => option.setName('user').setDescription('The user to merge').setRequired(true))
		.addStringOption(option => option.setName('city').setDescription('The city for the fork').setRequired(true))
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

	async execute(interaction) {
		const user = interaction.options.getUser('user');
		const city = interaction.options.getString('city');
		const guild = interaction.guild;

		const flags = config.PRIVACY.merge ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			// 1. Check for existing active fork
			const existingFork = await notion.findForkByCity(city);
			if (existingFork && existingFork.properties?.Status?.select?.name === 'Active') {
				const existingDiscordId = existingFork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
				if (existingDiscordId && existingDiscordId !== user.id) {
					const flags = config.PRIVACY.merge ? [MessageFlags.Ephemeral] : [];
					return await interaction.editReply({
						content: `❌ An active fork for **${city}** already exists.`,
						flags
					});
				}
			}

			const member = await guild.members.fetch(user.id);

			// 2. Assign roles using onboarding helper
			const { roleAssigned, contributorCityRole } = await setupOnboardingRoles(guild, member, city);

			// 3. Update Notion
			const fork = await notion.findForkByCity(city);
			if (fork) {
				await notion.updateForkStatus(fork.id, 'Active', user.id);
			}

			// 4. Create/Setup City Channel using onboarding helper
			const { channel, channelName } = await setupOnboardingChannel(guild, user, city, contributorCityRole);

			const successEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} PROTOCOL_MERGE // ACCESS_KEY_GENERATED`)
				.setDescription(`Synchronization complete. Credentials assigned to member: **<@${user.id}>**.`)
				.addFields(
					{ name: '⌬ NODE_LOCATION', value: `\`${city.toUpperCase()}\``, inline: true },
					{ name: '⌬ SYSTEM_ID', value: `\`${channelName.toUpperCase()}\``, inline: true }
				);

			if (!roleAssigned) {
				successEmbed.addFields({ name: 'Warning: Role Assignment', value: `The bot could not assign the **@fork-lead** role automatically because the bot's highest role is below the **@fork-lead** role in the server settings hierarchy. Please assign the role to <@${user.id}> manually.`, inline: false });
			}

			successEmbed.setColor(config.COLORS.success)
				.setThumbnail(interaction.guild.iconURL())
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			const handbookButton = new ButtonBuilder()
				.setLabel(config.BRANDING.documentationLabel)
				.setURL('https://www.notion.so/33949ed2fc33818ba073ffa2d815bf1a?v=33949ed2fc3380ccbfe2000c860aa29a&source=copy_link')
				.setStyle(ButtonStyle.Link);

			const row = new ActionRowBuilder().addComponents(handbookButton);

			await interaction.editReply({ embeds: [successEmbed], components: [row] });

			// Announce new fork to announcements channel
			try {
				const announcementChannel = await guild.channels.fetch(config.CHANNEL_IDS.announcement || '1490415427409412376');
				if (announcementChannel) {
					const capitalizedCity = city.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
					await announcementChannel.send(`**Bits&Bytes ${capitalizedCity}** is now live! Led by <@${user.id}>`);
				}
			} catch (error) {
				console.warn('[MERGE] Could not send announcement:', error.message);
			}

			// 5. Trigger self-healing permissions sync immediately
			try {
				const { syncForkPermissions } = require('../lib/channelSync');
				const updatedFork = await notion.findForkByCity(city);
				if (updatedFork) {
					await syncForkPermissions(guild.client, updatedFork);
				}
			} catch (syncErr) {
				console.warn('[MERGE] Permission sync fail:', syncErr.message);
			}

		} catch (error) {
			console.error('[MERGE] Error:', error);
			await interaction.editReply('❌ There was an error while merging the fork lead.');
		}
	},
};
