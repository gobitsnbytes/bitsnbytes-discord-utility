const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\akshat\\.gemini\\antigravity\\brain\\f88d4156-6e88-4a70-943e-4547fd671b09\\.system_generated\\steps\\1123\\output.txt';
const data = JSON.parse(fs.readFileSync(logPath, 'utf8'));

const blocks = data.results;

let markdown = '';

function blockToMarkdown(block) {
    const type = block.type;
    const contentObj = block[type];
    if (!contentObj || !contentObj.rich_text) {
        if (type === 'divider') return '---\n';
        return `[Unsupported block type: ${type}]\n`;
    }
    
    const text = contentObj.rich_text.map(t => t.plain_text).join('');
    
    switch (type) {
        case 'heading_1':
            return `\n# ${text}\n`;
        case 'heading_2':
            return `\n## ${text}\n`;
        case 'heading_3':
            return `\n### ${text}\n`;
        case 'paragraph':
            return `${text}\n`;
        case 'bulleted_list_item':
            return `* ${text}\n`;
        case 'numbered_list_item':
            return `1. ${text}\n`;
        case 'callout':
            const emoji = contentObj.icon?.emoji || '💡';
            return `> ${emoji} ${text}\n`;
        case 'code':
            return `\`\`\`${contentObj.language || ''}\n${text}\n\`\`\`\n`;
        default:
            return `${text}\n`;
    }
}

for (const block of blocks) {
    markdown += `[ID: ${block.id}] ` + blockToMarkdown(block);
}

fs.writeFileSync('scratch/notion_guide_parsed.md', markdown);
console.log('Parsed', blocks.length, 'blocks to scratch/notion_guide_parsed.md');
