const notion = require('../lib/notion');

async function checkForks() {
	try {
		console.log('Querying forks via helper...');
		const forks = await notion.getForks();

		console.log(`Found ${forks.length} pages.`);
		forks.forEach((page, i) => {
			console.log(`\n--- Page ${i + 1} ---`);
			const props = page.properties;
			const title = props['Fork Name']?.title?.[0]?.plain_text || 'Untitled';
			console.log('Title (Fork Name):', title);
			console.log('Status:', props['Status']?.select?.name);
			console.log('City:', props['What city are you in?']?.rich_text?.[0]?.plain_text);
			console.log('Discord ID:', props['Discord ID']?.rich_text?.[0]?.plain_text);
			console.log('Health Score:', props['Health Score']?.number);
			console.log('Points:', props['Points']?.number);
			console.log('Monthly Points:', props['Monthly Points']?.number);
			console.log('Team Completeness:', props['Team Completeness']?.number);
			console.log('Events Count:', props['Events Count']?.number);
		});
	} catch (e) {
		console.error('Error querying database:', e.message);
	}
}

checkForks();
