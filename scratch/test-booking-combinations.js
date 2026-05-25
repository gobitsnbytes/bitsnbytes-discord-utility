const dotenv = require('dotenv');
dotenv.config();

async function runTest(label, headers, body) {
    console.log(`--- Testing: ${label} ---`);
    const apiKey = process.env.CALCOM_API_KEY;
    const finalHeaders = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...headers
    };

    try {
        const res = await fetch('https://api.cal.com/v2/bookings', {
            method: 'POST',
            headers: finalHeaders,
            body: JSON.stringify(body)
        });
        const status = res.status;
        const text = await res.text();
        console.log(`Status: ${status}`);
        console.log(`Response: ${text.substring(0, 500)}`);
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

async function start() {
    const eventTypeId = 5707365;
    const startIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h from now

    // Combination 1: cal-api-version 2024-08-13, attendee object
    await runTest('Combo 1: 2024-08-13, attendee object', { 'cal-api-version': '2024-08-13' }, {
        eventTypeId,
        start: startIso,
        attendee: {
            name: 'Test Booker 1',
            email: 'hello@gobitsnbytes.org',
            timeZone: 'Asia/Kolkata',
            language: 'en'
        }
    });

    // Combination 2: cal-api-version 2024-06-14, attendee object
    await runTest('Combo 2: 2024-06-14, attendee object', { 'cal-api-version': '2024-06-14' }, {
        eventTypeId,
        start: startIso,
        attendee: {
            name: 'Test Booker 2',
            email: 'hello@gobitsnbytes.org',
            timeZone: 'Asia/Kolkata',
            language: 'en'
        }
    });

    // Combination 3: cal-api-version 2024-08-13, attendees array
    await runTest('Combo 3: 2024-08-13, attendees array', { 'cal-api-version': '2024-08-13' }, {
        eventTypeId,
        start: startIso,
        attendees: [{
            name: 'Test Booker 3',
            email: 'hello@gobitsnbytes.org',
            timeZone: 'Asia/Kolkata',
            language: 'en'
        }],
        timeZone: 'Asia/Kolkata',
        language: 'en'
    });

    // Combination 4: cal-api-version 2024-06-14, top-level timeZone/language, attendee object
    await runTest('Combo 4: 2024-06-14, top-level timeZone/language + attendee', { 'cal-api-version': '2024-06-14' }, {
        eventTypeId,
        start: startIso,
        timeZone: 'Asia/Kolkata',
        language: 'en',
        attendee: {
            name: 'Test Booker 4',
            email: 'hello@gobitsnbytes.org',
            timeZone: 'Asia/Kolkata',
            language: 'en'
        }
    });

    // Combination 5: cal-api-version 2024-08-13, including location
    await runTest('Combo 5: 2024-08-13, location object', { 'cal-api-version': '2024-08-13' }, {
        eventTypeId,
        start: startIso,
        timeZone: 'Asia/Kolkata',
        language: 'en',
        attendee: {
            name: 'Test Booker 5',
            email: 'hello@gobitsnbytes.org',
            timeZone: 'Asia/Kolkata',
            language: 'en'
        },
        location: 'google-meet'
    });

    // Combination 6: cal-api-version 2024-08-13, location object with type
    await runTest('Combo 6: 2024-08-13, location object with type', { 'cal-api-version': '2024-08-13' }, {
        eventTypeId,
        start: startIso,
        timeZone: 'Asia/Kolkata',
        language: 'en',
        attendee: {
            name: 'Test Booker 6',
            email: 'hello@gobitsnbytes.org',
            timeZone: 'Asia/Kolkata',
            language: 'en'
        },
        location: {
            type: 'google-meet'
        }
    });
}

start();
