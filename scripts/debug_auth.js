const notion = require('../lib/notion');
const auth = require('../lib/auth');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
	]
});

client.once('ready', async () => {
	try {
		console.log('Bot is online. Debugging auth for all active/pending forks...');
		const guild = client.guilds.cache.get(process.env.GUILD_ID);
		if (!guild) {
			console.error('Guild not found:', process.env.GUILD_ID);
			process.exit(1);
		}

		const forks = await notion.getForks();
		console.log(`Checking ${forks.length} forks...\n`);

		for (const fork of forks) {
			const city = notion.getCityName(fork);
			const leadName = fork.properties?.["What's your name?"]?.rich_text?.[0]?.text?.content || 'Unknown';
			const leadDiscordId = notion.getLeadDiscordId(fork);
			const status = fork.properties?.['Status']?.select?.name || 'Unknown';

			console.log(`=========================================`);
			console.log(`City: ${city} | Lead: ${leadName} | Discord ID: ${leadDiscordId}`);

			if (!leadDiscordId) {
				console.log('❌ No Discord ID set for this lead.');
				continue;
			}

			// Fetch member
			const member = await guild.members.fetch(leadDiscordId).catch(err => {
				console.log('❌ Member not found in guild:', err.message);
				return null;
			});

			if (member) {
				const isAuthorized = await auth.isAuthorizedForCity(member.user, city, guild);
				console.log(`Member in Guild: ${member.user.tag}`);
				console.log(`Roles: [${member.roles.cache.map(r => r.name).join(', ')}]`);
				console.log(`isAuthorizedForCity: ${isAuthorized ? '✅ TRUE' : '❌ FALSE'}`);
			}
		}

		process.exit(0);
	} catch (err) {
		console.error('Error during debug:', err);
		process.exit(1);
	}
});

client.login(process.env.DISCORD_TOKEN);
