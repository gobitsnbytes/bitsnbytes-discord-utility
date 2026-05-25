const db = require('../lib/db');
const meetingsDb = require('../lib/meetingsDb');

async function run() {
    console.log('Initializing database migrations...');
    try {
        // Just require meetingsDb to trigger database init logic
        console.log('Database initialized successfully.');
        
        // Let's check the schema of user_availability
        const tableInfo = await db.all("PRAGMA table_info(user_availability);");
        console.log('user_availability columns:', tableInfo.map(c => c.name));
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        db.close();
    }
}

run();
