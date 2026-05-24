const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ChannelType } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('archive')
		.setDescription('Mark a fork as stale and archive it.')
		.addStringOption(option => 
			option.setName('city')
				.setDescription('The city for the fork')
				.setRequired(true)
				.setAutocomplete(true))
		.addStringOption(option => option.setName('reason').setDescription('The reason for archival').setRequired(true))
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

	async execute(interaction) {
		const city = interaction.options.getString('city');
		const reason = interaction.options.getString('reason');
		const guild = interaction.guild;

		const flags = config.PRIVACY.archive ? [MessageFlags.Ephemeral] : [];
		await interaction.deferReply({ flags });

		try {
			// 1. Find the fork by city
			const fork = await notion.findForkByCity(city);
			if (!fork) {
				throw new Error(`Could not find a fork for city "${city}" in Notion.`);
			}

            // 2. Remove @fork-lead role
            const forkLeadId = fork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;
            if (forkLeadId) {
                const forkLeadRoleId = process.env.FORK_LEAD_ROLE_ID || '1490410901147488286';
                const forkLeadRole = guild.roles.cache.get(forkLeadRoleId) || guild.roles.cache.find(r => r.name === 'fork-lead' || r.name === 'fork lead');
                if (forkLeadRole) {
                    const member = await guild.members.fetch(forkLeadId).catch(() => null);
                    if (member) await member.roles.remove(forkLeadRole);
                }
            }

			// 3. Delete city channel
			const baseChannelName = city.toLowerCase().replace(/\s+/g, '-');
			const cityChannel = guild.channels.cache.find(c => 
				c.name === baseChannelName || 
				c.name === `gobitsnbytes-${baseChannelName}` ||
				c.name === `${baseChannelName}-archived` ||
				c.name === `gobitsnbytes-${baseChannelName}-archived`
			);
			if (cityChannel) {
				await cityChannel.delete(`Fork for ${city} archived/decommissioned.`);
			}

			// 4. Update Notion status
			await notion.updateForkStatus(fork.id, 'Archived');

			const embed = new EmbedBuilder()
				.setTitle(`${config.EMOJIS.archived} PROTOCOL ARCHIVAL: SUCCESSFUL`)
				.setDescription(`The fork for **${city}** has been decommissioned and archived.`)
				.addFields(
					{ name: 'REASON', value: reason }
				)
				.setColor(config.COLORS.neutral)
				.setThumbnail(interaction.guild.iconURL())
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error('[ARCHIVE] Error:', error);
			await interaction.editReply('❌ There was an error while archiving the fork.');
		}
	},

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();
		const guild = interaction.guild;
		const citiesSet = new Set();

		// 1. Get cities from channels under 'FORKS' category
		try {
			const category = guild.channels.cache.find(c => 
				c.name.toUpperCase() === 'FORKS' && 
				c.type === ChannelType.GuildCategory
			);
			if (category) {
				const channels = guild.channels.cache.filter(c => c.parentId === category.id);
				for (const [, channel] of channels) {
					let name = channel.name;
					if (name.startsWith('gobitsnbytes-')) {
						name = name.replace('gobitsnbytes-', '');
					}
					if (name.endsWith('-archived')) {
						name = name.replace('-archived', '');
					}
					const cityTitleCase = name
						.split('-')
						.map(word => word.charAt(0).toUpperCase() + word.slice(1))
						.join(' ');
					
					citiesSet.add(cityTitleCase);
				}
			}
		} catch (err) {
			console.warn('[ARCHIVE_AUTOCOMPLETE] Channel search failed:', err.message);
		}

		// 2. Fallback/merge with Notion database
		try {
			const forks = await notion.getForks();
			for (const fork of forks) {
				const city = fork.properties?.["What city are you in?"]?.rich_text?.[0]?.text?.content || 
				             fork.properties?.City?.rich_text?.[0]?.text?.content || 
				             fork.properties?.["Fork Name"]?.title?.[0]?.text?.content;
				if (city) {
					citiesSet.add(city);
				}
			}
		} catch (err) {
			console.warn('[ARCHIVE_AUTOCOMPLETE] Notion search failed:', err.message);
		}

		const citiesList = Array.from(citiesSet);
		const filtered = citiesList.filter(city => 
			city.toLowerCase().includes(focusedValue.toLowerCase())
		);

		await interaction.respond(
			filtered.slice(0, 25).map(city => ({ name: city, value: city }))
		).catch(() => {});
	}
};
