const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const notion = require('../lib/notion');
const config = require('../config');
const auth = require('../lib/auth');
require('dotenv').config();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers
	]
});

// Delay helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

client.once('ready', async () => {
	console.log(`[DM_PRUNE] Logged in as ${client.user.tag}`);
	
	try {
		const guildId = process.env.GUILD_ID || '1480617556292272260';
		const guild = await client.guilds.fetch(guildId);
		console.log(`[DM_PRUNE] Fetching all members for guild: ${guild.name}`);
		await guild.members.fetch();

		const contributorRoleId = config.ROLE_IDS.contributor || '1506019068132462804';
		const contributorRole = guild.roles.cache.get(contributorRoleId);
		
		if (!contributorRole) {
			console.error(`[DM_PRUNE ERROR] Contributor role with ID ${contributorRoleId} not found in guild.`);
			process.exit(1);
		}

		// Filter members with the contributor role (excluding bots)
		const staffMembers = guild.members.cache.filter(m => !m.user.bot && m.roles.cache.has(contributorRole.id));
		console.log(`[DM_PRUNE] Found ${staffMembers.size} staff members with the Contributor role.`);

		let sentCount = 0;
		let failedCount = 0;

		const embed = new EmbedBuilder()
			.setTitle(`⚠️ CHAPTER MAINTENANCE & ARCHIVE NOTICE`)
			.setDescription(`Please note that active engagement, regular operations, and consistent reporting are core requirements for all local chapters.

As part of our upcoming operational cleanup:
- **Dead, inactive, or slow forks will be pruned and archived.**
- Please ensure that your team structures are defined, weekly pulse updates are submitted via \`/pulse\`, and all planned events/reports are current in the system.

If you have any questions or require operational support, please contact the Core / HQ Team immediately.`)
			.setColor(config.COLORS.warning)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		for (const [memberId, member] of staffMembers) {
			const isHq = auth.isExecutiveLeader(member) || auth.isDepartmentLead(member);
			
			// Do NOT send fork warnings to HQ people
			if (isHq) {
				console.log(`[DM_PRUNE] Skipping HQ member ${member.user.tag}`);
				continue;
			}

			const cityName = auth.getMemberCity(member); // Returns resolved city name or null
			const displayCity = cityName ? cityName.charAt(0).toUpperCase() + cityName.slice(1) : 'your local';

			// Personalized message greeting
			const personalEmbed = EmbedBuilder.from(embed)
				.setDescription(`Hey **${member.displayName}**, as a member of the **Bits&Bytes ${displayCity} Fork Team**, please read the following operational notice carefully:

${embed.data.description}`);

			try {
				console.log(`[DM_PRUNE] Sending DM to ${member.user.tag} (Fork: ${cityName || 'None'})`);
				await member.send({ embeds: [personalEmbed] });
				sentCount++;
				await sleep(1500); // 1.5 seconds delay between DMs to respect rate limits
			} catch (err) {
				console.warn(`[DM_PRUNE WARNING] Failed to send DM to ${member.user.tag}: ${err.message}`);
				failedCount++;
			}
		}

		console.log(`\n[DM_PRUNE] Finished sending prune warning DMs. Sent: ${sentCount}, Failed/Blocked: ${failedCount}`);
		process.exit(0);
	} catch (err) {
		console.error('[DM_PRUNE ERROR]', err);
		process.exit(1);
	}
});

client.login(process.env.DISCORD_TOKEN);
