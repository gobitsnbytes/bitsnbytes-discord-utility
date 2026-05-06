const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
console.log('Notion client keys:', Object.keys(notion));
if (notion.databases) {
    console.log('Notion.databases keys:', Object.keys(notion.databases));
} else {
    console.log('notion.databases is undefined');
}
