const notion = require('../lib/notion');

(async () => {
	try {
		console.log('Fetching active forks...');
		const forks = await notion.getForks();
		
		for (const fork of forks) {
			const city = notion.getCityName(fork);
			const team = await notion.getTeamMembers(fork.id);
			console.log(`\nFork: ${city} (ID: ${fork.id}) | Total Team: ${team.length}`);
			team.forEach(m => {
				console.log(`  - Member: ${m.name.padEnd(20)} | Discord ID: ${m.discordId.padEnd(20)} | Role: ${m.role}`);
			});
		}
		process.exit(0);
	} catch (err) {
		console.error('Error:', err);
		process.exit(1);
	}
})();
