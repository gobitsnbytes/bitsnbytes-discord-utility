const dotenv = require('dotenv');
dotenv.config();

async function testEventTypesHeader(version) {
    console.log(`--- Testing Event Types with Version: ${version} ---`);
    const apiKey = process.env.CALCOM_API_KEY;
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'cal-api-version': version
    };

    try {
        const res = await fetch('https://api.cal.com/v2/event-types', { headers });
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log(`Response: ${text.substring(0, 300)}`);
    } catch (err) {
        console.error(err);
    }
}

async function run() {
    await testEventTypesHeader('2024-08-13');
    await testEventTypesHeader('2024-06-14');
}

run();
