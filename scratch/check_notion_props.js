const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_FORK_REGISTRY_DB;

async function checkProperties() {
    try {
        console.log('Retrieving database details for ID:', databaseId);
        const db = await notion.databases.retrieve({ database_id: databaseId });
        console.log('Database Title:', db.title?.[0]?.plain_text || 'Untitled');
        if (!db.properties) {
            console.log('Full DB response:', JSON.stringify(db, null, 2));
            throw new Error('No properties found in database object');
        }
        console.log('Properties found:');
        Object.keys(db.properties).forEach(prop => {
            console.log(`- ${prop} (${db.properties[prop].type})`);
        });
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkProperties();
