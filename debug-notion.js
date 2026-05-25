const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_FORK_REGISTRY_DB;

async function checkForks() {
    try {
        console.log('Retrieving database details...');
        const db = await notion.databases.retrieve({ database_id: databaseId });
        console.log('Database retrieved. Data sources:', JSON.stringify(db.data_sources, null, 2));
        
        const dataSourceId = db.data_sources?.[0]?.id;
        if (!dataSourceId) {
            throw new Error('No data source found for this database.');
        }

        console.log('Querying data source:', dataSourceId);
        const response = await notion.dataSources.query({
            data_source_id: dataSourceId,
        });
        
        console.log('Forks count:', response.results.length);
        response.results.forEach((f, i) => {
            console.log(`\nFork ${i + 1}:`);
            console.log('Status:', JSON.stringify(f.properties.Status, null, 2));
            console.log('City:', JSON.stringify(f.properties['What city are you in?'], null, 2));
            console.log('Discord ID:', JSON.stringify(f.properties['Discord ID'], null, 2));
        });
    } catch (error) {
        console.error('Error fetching forks:', error);
    }
}

checkForks();
