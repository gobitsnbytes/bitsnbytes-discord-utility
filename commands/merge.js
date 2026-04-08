const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const notion = require('../lib/notion');

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

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			// 1. Assign @fork-lead role
			const forkLeadRole = guild.roles.cache.find(r => r.name === 'fork-lead');
			if (forkLeadRole) {
				const member = await guild.members.fetch(user.id);
				await member.roles.add(forkLeadRole);
			}

			// 2. Create city channel under FORKS category
			const category = guild.channels.cache.find(c => c.name === 'FORKS' && c.type === ChannelType.GuildCategory);
			const channelName = city.toLowerCase().replace(/\s+/g, '-');
			
			const cityChannel = await guild.channels.create({
				name: channelName,
				type: ChannelType.GuildText,
				parent: category ? category.id : null,
			});

			// 3. Post to #forks-info
			const infoChannel = guild.channels.cache.find(c => c.name === 'forks-info');
			if (infoChannel) {
				await infoChannel.send(`🍴 bitsnbytes-${cityChannel.name} is now live. lead: <@${user.id}>`);
			}

			// 4. Send Onboarding DM
			const onboardingMsg = `you've been merged in as the fork lead for bitsnbytes-${city} 🍴

here's what happens next:
→ read the fork handbook: ${process.env.FORK_HANDBOOK_URL}
→ your email ${city.toLowerCase()}@gobitsnbytes.org will be set up by the team
→ your local channel is <#${cityChannel.id}> on this server
→ you're now in #leads-council — that's where the network coordinates
→ run /pulse to post your first activity update when you're ready

welcome to the network.
— b&b`;

			try {
				await user.send(onboardingMsg);
			} catch (e) {
				console.log(`[MERGE] Could not send DM to ${user.tag}.`);
			}

			// 5. Update Notion
			const fork = await notion.findForkByCity(city);
			if (fork) {
				await notion.updateForkStatus(fork.id, 'Active');
			}

			await interaction.editReply(`✅ Successfully merged **@${user.tag}** as the lead for **${city}**.`);

		} catch (error) {
			console.error('[MERGE] Error:', error);
			await interaction.editReply('❌ There was an error while merging the fork lead.');
		}
	},
};
