const dotenv = require('dotenv');
dotenv.config();

async function run() {
    console.log('Testing slots with 2024-09-04 version...');
    const apiKey = process.env.CALCOM_API_KEY;
    const startIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const endIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const eventTypeId = 5707365;

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'cal-api-version': '2024-09-04'
    };

    const url = `https://api.cal.com/v2/slots?eventTypeId=${eventTypeId}&start=${startIso}&end=${endIso}`;
    try {
        const res = await fetch(url, { headers });
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log('Response:', text.substring(0, 500));
    } catch (err) {
        console.error(err);
    }
}

run();
