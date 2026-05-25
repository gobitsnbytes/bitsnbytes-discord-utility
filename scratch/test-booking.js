const dotenv = require('dotenv');
dotenv.config();

const calcom = require('../lib/calcom');

async function testBooking() {
    // Let's first fetch all event types to get a valid one
    const eventTypes = await calcom.getEventTypes();
    if (eventTypes.length === 0) {
        console.error('No event types found.');
        return;
    }
    const eventType = eventTypes[0];
    console.log('Using event type:', eventType.id, eventType.title);

    const bookingBody = {
        eventTypeId: eventType.id,
        start: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
        timeZone: 'Asia/Kolkata',
        language: 'en',
        metadata: {
            discord_meeting_id: 'test-meeting-' + Date.now()
        },
        attendee: {
            name: 'Test Booker',
            email: 'hello@gobitsnbytes.org',
            timeZone: 'Asia/Kolkata'
        }
    };

    console.log('Sending bookingBody:', JSON.stringify(bookingBody, null, 2));
    const result = await calcom.createBooking(bookingBody);
    console.log('Booking Result:', result);
}

testBooking();
