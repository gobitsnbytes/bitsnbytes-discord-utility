const dotenv = require('dotenv');
dotenv.config();

const calcom = require('../lib/calcom');

async function debug() {
    console.log('Testing Cal.com API with Key:', process.env.CALCOM_API_KEY ? 'Present' : 'Missing');
    try {
        const eventTypes = await calcom.getEventTypes();
        console.log('Event types response:', JSON.stringify(eventTypes, null, 2));
    } catch (err) {
        console.error('Error during getEventTypes:', err);
    }
}

debug();
