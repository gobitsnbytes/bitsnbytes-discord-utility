const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_FORK_REGISTRY_DB;

async function queryDatabase(id) {
    const https = require('https');
    const postData = JSON.stringify({ page_size: 1 });

    const options = {
        hostname: 'api.notion.com',
        port: 443,
        path: `/v1/databases/${id}/query`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
        },
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data || '{}');
                    resolve(parsed);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

async function checkSamplePage() {
    try {
        console.log('Querying database via HTTPS...');
        const response = await queryDatabase(databaseId);
        
        if (!response.results || response.results.length === 0) {
            console.log('No pages found or error:', response);
            return;
        }
        
        const page = response.results[0];
        console.log('Sample Page ID:', page.id);
        console.log('Properties found in sample page:');
        Object.keys(page.properties).forEach(prop => {
            console.log(`- ${prop} (${page.properties[prop].type})`);
        });
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkSamplePage();
