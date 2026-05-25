const dotenv = require('dotenv');
dotenv.config();

async function testSlots(version) {
    console.log(`--- Testing Slots with Version: ${version} ---`);
    const apiKey = process.env.CALCOM_API_KEY;
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'cal-api-version': version
    };

    const eventTypeId = 5707365;
    const startIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const endIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // Use start and end instead of startTime and endTime
    const url = `https://api.cal.com/v2/slots?eventTypeId=${eventTypeId}&start=${startIso}&end=${endIso}`;

    try {
        const res = await fetch(url, { headers });
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log(`Response: ${text.substring(0, 500)}`);
    } catch (err) {
        console.error(err);
    }
}

async function run() {
    // Let's test with 2024-06-14 and 2024-08-13
    await testSlots('2024-06-14');
    await testSlots('2024-08-13');
}

run();
