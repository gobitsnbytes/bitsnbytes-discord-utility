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
	console.log(`[DM] Logged in as ${client.user.tag}`);
	
	try {
		const guildId = process.env.GUILD_ID || '1480617556292272260';
		const guild = await client.guilds.fetch(guildId);
		console.log(`[DM] Fetching all members for guild: ${guild.name}`);
		await guild.members.fetch();

		const contributorRoleId = config.ROLE_IDS.contributor || '1506019068132462804';
		const contributorRole = guild.roles.cache.get(contributorRoleId);
		
		if (!contributorRole) {
			console.error(`[DM ERROR] Contributor role with ID ${contributorRoleId} not found in guild.`);
			process.exit(1);
		}

		// Filter members with the contributor role (excluding bots)
		const staffMembers = guild.members.cache.filter(m => !m.user.bot && m.roles.cache.has(contributorRole.id));
		console.log(`[DM] Found ${staffMembers.size} staff members with the Contributor role.`);

		let sentCount = 0;
		let failedCount = 0;

		for (const [memberId, member] of staffMembers) {
			const isHq = auth.isExecutiveLeader(member) || auth.isDepartmentLead(member);
			const cityName = auth.getMemberCity(member); // Returns resolved city name or null
			const displayCity = cityName ? cityName.charAt(0).toUpperCase() + cityName.slice(1) : 'your local';

			// Construct customized message
			const embed = new EmbedBuilder()
				.setTitle(`⚡ BITS&BYTES // CORE_ONBOARDING`)
				.setColor(config.COLORS.primary)
				.setTimestamp()
				.setFooter({ text: config.BRANDING.footerText });

			if (isHq) {
				// HQ customized message
				embed.setDescription(`Hey **${member.displayName}**, as a member of the **Bits&Bytes Core / HQ Team**, your scheduling profile has been initialized at https://cal.gobitsnbytes.org!

Please complete the following setup steps immediately:

1. **Scheduling Portal Setup**: Log in to https://cal.gobitsnbytes.org (via Discord Login) to configure your availability, track preferences, and update your profile bio to reflect your leadership focus/departments.
2. **Discord Nickname**: Ensure your Discord nickname in the server is updated to your **Legal Name** to keep team communication professional.
3. **Bits&Bytes Wiki**: You are required to read, go through, and follow the **[Bits&Bytes Wiki](https://app.notion.com/p/33949ed2fc33818ba073ffa2d815bf1a?v=33949ed2fc3380ccbfe2000c860aa29a&source=copy_link)** at all times. Bookmark it and stay updated with the guidelines.
4. **Coordination**: Start using the scheduling and meeting functions to manage track syncs, events, and reviews.`);
			} else {
				// Fork customized message
				embed.setDescription(`Hey **${member.displayName}**, as a member of the **Bits&Bytes ${displayCity} Fork Team**, your scheduling profile has been initialized at https://cal.gobitsnbytes.org!

Please complete the following setup steps immediately:

1. **Scheduling Portal Setup**: Log in to https://cal.gobitsnbytes.org (via Discord Login) to configure your availability, local fork preferences, and update your profile bio to reflect your track/role (e.g., Tech, Ops, Creative) in the fork.
2. **Discord Nickname**: Ensure your Discord nickname in the server is updated to your **Legal Name** to keep team communication professional.
3. **Bits&Bytes Wiki**: You are required to read, go through, and follow the **[Bits&Bytes Wiki](https://app.notion.com/p/33949ed2fc33818ba073ffa2d815bf1a?v=33949ed2fc3380ccbfe2000c860aa29a&source=copy_link)** at all times. Bookmark it and stay updated with the guidelines.
4. **Updates**: Set up your slots, start scheduling your fork syncs, and send regular pulse/meeting updates via the Discord commands.`);
			}

			try {
				console.log(`[DM] Sending DM to ${member.user.tag} (HQ: ${isHq}, Fork: ${cityName || 'None'})`);
				await member.send({ embeds: [embed] });
				sentCount++;
				await sleep(1500); // 1.5 seconds delay between DMs to respect rate limits
			} catch (err) {
				console.warn(`[DM WARNING] Failed to send DM to ${member.user.tag}: ${err.message}`);
				failedCount++;
			}
		}

		console.log(`\n[DM] Finished sending onboarding DMs. Sent: ${sentCount}, Failed/Blocked: ${failedCount}`);
		process.exit(0);
	} catch (err) {
		console.error('[DM ERROR]', err);
		process.exit(1);
	}
});

client.login(process.env.DISCORD_TOKEN);
