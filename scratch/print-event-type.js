const dotenv = require('dotenv');
dotenv.config();

const calcom = require('../lib/calcom');

async function run() {
    const eventTypes = await calcom.getEventTypes();
    const target = eventTypes.find(et => String(et.id) === '5707365');
    console.log(JSON.stringify(target, null, 2));
}

run();
