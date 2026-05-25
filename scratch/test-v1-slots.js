const dotenv = require('dotenv');
dotenv.config();

async function run() {
    console.log('Testing slots under v1...');
    const apiKey = process.env.CALCOM_API_KEY;
    const startIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const endIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const eventTypeId = 5707365;

    // Try v1 URL
    const url = `https://api.cal.com/v1/slots?apiKey=${apiKey}&eventTypeId=${eventTypeId}&startTime=${startIso}&endTime=${endIso}`;
    try {
        const res = await fetch(url);
        console.log(`Status: ${res.status}`);
        const data = await res.json();
        console.log('Response data:', JSON.stringify(data, null, 2).substring(0, 500));
    } catch (err) {
        console.error(err);
    }
}

run();
