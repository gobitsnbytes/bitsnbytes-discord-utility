const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');

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

			// 2. Assign @fork-lead role
			const forkLeadRole = guild.roles.cache.find(r => r.name === 'fork-lead');
			if (!forkLeadRole) throw new Error('@fork-lead role not found in server.');
			
			const member = await guild.members.fetch(user.id);
			await member.roles.add(forkLeadRole);

			// 3. Update Notion
			const fork = await notion.findForkByCity(city);
			if (fork) {
				await notion.updateForkStatus(fork.id, 'Active', user.id);
			}

			// 4. Create/Setup City Channel
			const category = guild.channels.cache.find(c => c.name === 'FORKS' && c.type === ChannelType.GuildCategory);
			const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;
			
			const overwrites = [
				{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
				{ id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
			];

			// Include Staff role explicitly if it exists
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
				// If channel already exists, update/set the isolated permission overwrites
				await channel.permissionOverwrites.set(overwrites);
			}

			const successEmbed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.protocol} PROTOCOL_MERGE // ACCESS_KEY_GENERATED`)
				.setDescription(`Synchronization complete. Credentials assigned to member: **<@${user.id}>**.`)
				.addFields(
					{ name: '⌬ NODE_LOCATION', value: `\`${city.toUpperCase()}\``, inline: true },
					{ name: '⌬ SYSTEM_ID', value: `\`${channelName.toUpperCase()}\``, inline: true }
				)
				.setColor(config.COLORS.success)
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
				const announcementChannel = await guild.channels.fetch('1490415427409412376');
				if (announcementChannel) {
					await announcementChannel.send(`**Bits&Bytes ${city}** is now live! Led by <@${user.id}>`);
				}
			} catch (error) {
				console.warn('[MERGE] Could not send announcement:', error.message);
			}

		} catch (error) {
			console.error('[MERGE] Error:', error);
			await interaction.editReply('❌ There was an error while merging the fork lead.');
		}
	},
};
