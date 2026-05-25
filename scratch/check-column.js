const db = require('../lib/db');

async function run() {
    try {
        console.log('Querying associated_role_id column...');
        const row = await db.get("SELECT associated_role_id FROM user_availability LIMIT 1");
        console.log('Column exists! Value:', row);
    } catch (err) {
        console.error('Column check failed:', err.message);
        console.log('Attempting to run manual migration...');
        try {
            await db.run("ALTER TABLE user_availability ADD COLUMN associated_role_id TEXT");
            console.log('Migration succeeded!');
        } catch (migErr) {
            console.error('Manual migration failed:', migErr.message);
        }
    } finally {
        db.close();
    }
}

run();
