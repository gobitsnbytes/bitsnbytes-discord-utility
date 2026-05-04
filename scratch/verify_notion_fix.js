const notionLib = require('../lib/notion');
require('dotenv').config();

async function testPropertyValidation() {
    console.log('Testing Notion property validation...');
    // We'll use a dummy page ID or a known one, but we expect it to fail because the property is missing
    const dummyPageId = '33949ed2-fc33-8158-a281-e873e130c2af'; // Using the sample ID we found earlier
    
    try {
        console.log(`Attempting to update Step 1 for page ${dummyPageId}...`);
        await notionLib.updateOnboardingStep(dummyPageId, 1, true);
        console.log('SUCCESS: Property update succeeded (unexpected if property is missing)');
    } catch (error) {
        console.log('CAUGHT EXPECTED ERROR:');
        console.log(error.message);
        if (error.message.includes('missing the required property')) {
            console.log('✅ PASS: Correct descriptive error message returned.');
        } else {
            console.log('❌ FAIL: Error message did not contain expected guidance.');
        }
    }
}

testPropertyValidation();
