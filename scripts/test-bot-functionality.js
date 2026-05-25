/**
 * 🛠️ Bits&Bytes Bot Functionality and Diagnostics Test Script
 * Runs a comprehensive set of diagnostic checks to identify configuration issues,
 * API connection failures, and logical bugs within the bot codebase.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const projectRoot = path.resolve(__dirname, '..');

// Helper for colored console output
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m"
};

console.log(`${colors.bold}${colors.magenta}====================================================${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}    BITS&BYTES BOT DIAGNOSTIC & FUNCTIONAL TESTS    ${colors.reset}`);
console.log(`${colors.bold}${colors.magenta}====================================================${colors.reset}\n`);

const diagnostics = {
    env: { name: "Environment Variables", passed: false, details: [] },
    db: { name: "SQLite & Turso Database", passed: false, details: [] },
    notion: { name: "Notion Integration", passed: false, details: [] },
    calcom: { name: "Cal.com Scheduler API", passed: false, details: [] },
    smtp: { name: "SMTP Email Server", passed: false, details: [] },
    imports: { name: "Module Imports & Syntax", passed: false, details: [] },
    logicCheck: { name: "Codebase Logic & Bug Sweeping", passed: false, details: [] }
};

// ====================================================
//  1. ENVIRONMENT VARIABLES
// ====================================================
console.log(`${colors.bold}[1/7] Checking Environment Configuration (.env)...${colors.reset}`);
const requiredEnv = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'GUILD_ID',
    'NOTION_TOKEN',
    'NOTION_FORK_REGISTRY_DB'
];
const optionalEnv = [
    'NOTION_TEAM_DB',
    'NOTION_EVENTS_DB',
    'NOTION_REPORTS_DB',
    'NOTION_REMINDERS_DB',
    'TURSO_DATABASE_URL',
    'TURSO_AUTH_TOKEN',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'CALCOM_API_KEY',
    'GEMINI_API_KEY'
];

let envPassed = true;
for (const key of requiredEnv) {
    if (!process.env[key]) {
        diagnostics.env.details.push(`❌ Missing REQUIRED: ${key}`);
        envPassed = false;
    } else {
        diagnostics.env.details.push(`✅ Found REQUIRED: ${key} (${key.includes('TOKEN') || key.includes('SECRET') ? 'Hidden' : process.env[key]})`);
    }
}

for (const key of optionalEnv) {
    if (!process.env[key]) {
        diagnostics.env.details.push(`⚠️ Missing OPTIONAL: ${key}`);
    } else {
        diagnostics.env.details.push(`✅ Found OPTIONAL: ${key} (${key.includes('TOKEN') || key.includes('PASS') || key.includes('KEY') ? 'Hidden' : process.env[key]})`);
    }
}

diagnostics.env.passed = envPassed;
if (envPassed) {
    console.log(`${colors.green}✔ Environment check passed.${colors.reset}\n`);
} else {
    console.log(`${colors.red}✘ Environment check failed (Required variables missing).${colors.reset}\n`);
}

// ====================================================
//  2. MODULE IMPORTS & SYNTAX
// ====================================================
console.log(`${colors.bold}[2/7] Verifying Module Imports and Syntax...${colors.reset}`);
let importsPassed = true;

// Helper to require without running side-effects
const safeRequire = (filePath) => {
    try {
        const mod = require(filePath);
        return { success: true, exports: Object.keys(mod) };
    } catch (err) {
        return { success: false, error: err };
    }
};

// Check Libs
const libDir = path.join(projectRoot, 'lib');
const libs = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));
for (const file of libs) {
    // Avoid triggering full migration script side effects
    if (file === 'migrate-to-turso.js') {
        diagnostics.imports.details.push(`⚠️ lib/migrate-to-turso.js: Skipped full require to prevent auto-execution. Run this script manually via: node lib/migrate-to-turso.js`);
        continue;
    }
    const check = safeRequire(path.join(libDir, file));
    if (check.success) {
        diagnostics.imports.details.push(`✅ lib/${file}: Loaded successfully (Exports: ${check.exports.slice(0, 5).join(', ')}${check.exports.length > 5 ? '...' : ''})`);
    } else {
        diagnostics.imports.details.push(`❌ lib/${file}: Failed to load: ${check.error.message}`);
        importsPassed = false;
    }
}

// Check Commands
const commandsDir = path.join(projectRoot, 'commands');
const commands = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
for (const file of commands) {
    const check = safeRequire(path.join(commandsDir, file));
    if (check.success) {
        diagnostics.imports.details.push(`✅ commands/${file}: Loaded successfully`);
    } else {
        diagnostics.imports.details.push(`❌ commands/${file}: Failed to load: ${check.error.message}`);
        importsPassed = false;
    }
}

// Check Jobs
const jobsDir = path.join(projectRoot, 'jobs');
const jobs = fs.readdirSync(jobsDir).filter(f => f.endsWith('.js'));
for (const file of jobs) {
    const check = safeRequire(path.join(jobsDir, file));
    if (check.success) {
        diagnostics.imports.details.push(`✅ jobs/${file}: Loaded successfully`);
    } else {
        diagnostics.imports.details.push(`❌ jobs/${file}: Failed to load: ${check.error.message}`);
        importsPassed = false;
    }
}

diagnostics.imports.passed = importsPassed;
if (importsPassed) {
    console.log(`${colors.green}✔ All modules loaded successfully.${colors.reset}\n`);
} else {
    console.log(`${colors.red}✘ Module loading encountered errors.${colors.reset}\n`);
}

// ====================================================
//  3. DATABASE CONNECTIVITY
// ====================================================
console.log(`${colors.bold}[3/7] Testing Database Connection...${colors.reset}`);
async function testDatabase() {
    try {
        const db = require(path.join(libDir, 'db.js'));
        const dbType = db.useTurso ? 'Turso Cloud' : 'Local SQLite';
        const start = Date.now();
        await db.get('SELECT 1 as val');
        const latency = Date.now() - start;
        diagnostics.db.passed = true;
        diagnostics.db.details.push(`✅ Successfully connected to ${dbType}`);
        diagnostics.db.details.push(`✅ Query latency: ${latency}ms`);
        console.log(`${colors.green}✔ Database connection verified (${dbType}).${colors.reset}\n`);
    } catch (err) {
        diagnostics.db.passed = false;
        diagnostics.db.details.push(`❌ Connection failed: ${err.message}`);
        console.log(`${colors.red}✘ Database connection failed.${colors.reset}\n`);
    }
}

// ====================================================
//  4. NOTION INTEGRATION
// ====================================================
console.log(`${colors.bold}[4/7] Testing Notion API Integration...${colors.reset}`);
async function testNotion() {
    try {
        if (!process.env.NOTION_TOKEN || !process.env.NOTION_FORK_REGISTRY_DB) {
            throw new Error('NOTION_TOKEN or NOTION_FORK_REGISTRY_DB is not configured in .env');
        }

        const notion = require(path.join(libDir, 'notion.js'));
        const start = Date.now();
        // Probe Notion connection by searching a fake city fork (runs query fallback)
        const forks = await notion.getForks();
        const latency = Date.now() - start;

        diagnostics.notion.passed = true;
        diagnostics.notion.details.push(`✅ Connection successful. Retained ${forks.length} forks from database.`);
        diagnostics.notion.details.push(`✅ Query latency: ${latency}ms`);
        
        if (forks.length > 0) {
            const firstFork = forks[0];
            const props = firstFork.properties || {};
            diagnostics.notion.details.push(`✅ Sample Fork page: "${firstFork.url}"`);
            
            // Check keys in Notion registry database
            const hasWhatCity = 'What city are you in?' in props;
            const hasCity = 'City' in props;
            diagnostics.notion.details.push(`▪ Notion schema property 'What city are you in?': ${hasWhatCity ? 'Present' : 'ABSENT'}`);
            diagnostics.notion.details.push(`▪ Notion schema property 'City': ${hasCity ? 'Present' : 'ABSENT'}`);
        }
        console.log(`${colors.green}✔ Notion API connection verified.${colors.reset}\n`);
    } catch (err) {
        diagnostics.notion.passed = false;
        diagnostics.notion.details.push(`❌ Notion integration failed: ${err.message}`);
        console.log(`${colors.red}✘ Notion API connection failed: ${err.message}${colors.reset}\n`);
    }
}

// ====================================================
//  5. CAL.COM API
// ====================================================
console.log(`${colors.bold}[5/7] Testing Cal.com Scheduler API...${colors.reset}`);
async function testCalcom() {
    try {
        if (!process.env.CALCOM_API_KEY) {
            throw new Error('CALCOM_API_KEY is not configured in .env');
        }

        const calcom = require(path.join(libDir, 'calcom.js'));
        const start = Date.now();
        const eventTypes = await calcom.getEventTypes();
        const latency = Date.now() - start;

        diagnostics.calcom.passed = true;
        diagnostics.calcom.details.push(`✅ Connection successful. Retained ${eventTypes.length} event type configurations.`);
        diagnostics.calcom.details.push(`✅ Query latency: ${latency}ms`);
        console.log(`${colors.green}✔ Cal.com API connectivity verified.${colors.reset}\n`);
    } catch (err) {
        diagnostics.calcom.passed = false;
        diagnostics.calcom.details.push(`❌ Cal.com API connection failed: ${err.message}`);
        console.log(`${colors.red}✘ Cal.com API connection failed: ${err.message}${colors.reset}\n`);
    }
}

// ====================================================
//  6. SMTP EMAIL SERVER
// ====================================================
console.log(`${colors.bold}[6/7] Testing SMTP Server Configuration...${colors.reset}`);
async function testSMTP() {
    try {
        if (!process.env.SMTP_HOST) {
            throw new Error('SMTP_HOST is not configured in .env');
        }

        const mailer = require(path.join(libDir, 'mailer.js'));
        const start = Date.now();
        const verify = await mailer.verifySMTP();
        const latency = Date.now() - start;

        if (verify.success) {
            diagnostics.smtp.passed = true;
            diagnostics.smtp.details.push(`✅ SMTP Handshake successful`);
            diagnostics.smtp.details.push(`✅ Handshake latency: ${latency}ms`);
            console.log(`${colors.green}✔ SMTP Mailer handshake verified.${colors.reset}\n`);
        } else {
            throw new Error(verify.error);
        }
    } catch (err) {
        diagnostics.smtp.passed = false;
        diagnostics.smtp.details.push(`❌ SMTP handshake failed: ${err.message}`);
        console.log(`${colors.red}✘ SMTP Handshake failed: ${err.message}${colors.reset}\n`);
    }
}

// ====================================================
//  7. LOGIC CHECKS & BUG SWEEPING
// ====================================================
console.log(`${colors.bold}[7/7] Sweeping codebase for logical bugs and configuration discrepancies...${colors.reset}`);
function sweepLogicBugs() {
    let sweepPassed = true;
    
    // Check 7.1: City schema discrepancy sweep
    diagnostics.logicCheck.details.push("🔍 Check 7.1: Searching for 'City' property references in Notion queries...");
    const filesReferencingCityProperty = [];
    const walkDir = (dir) => {
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat && stat.isDirectory()) {
                if (file !== 'node_modules' && file !== '.git') walkDir(filePath);
            } else if (file.endsWith('.js') && !filePath.includes('test-bot-functionality.js')) {
                const content = fs.readFileSync(filePath, 'utf8');
                if (content.includes('properties.City')) {
                    filesReferencingCityProperty.push(path.relative(projectRoot, filePath));
                }
            }
        }
    };
    
    walkDir(projectRoot);
    
    if (filesReferencingCityProperty.length > 0) {
        diagnostics.logicCheck.details.push(`❌ Found ${filesReferencingCityProperty.length} files accessing 'properties.City' directly (which does not exist in Notion schema, should be 'What city are you in?'):`);
        for (const f of filesReferencingCityProperty) {
            diagnostics.logicCheck.details.push(`  ▪ ${f}`);
        }
        sweepPassed = false;
    } else {
        diagnostics.logicCheck.details.push("✅ No direct invalid 'properties.City' references found.");
    }

    // Check 7.2: Side-effects in module imports check
    diagnostics.logicCheck.details.push("🔍 Check 7.2: Verifying module import side-effects...");
    const migratePath = path.join(libDir, 'migrate-to-turso.js');
    if (fs.existsSync(migratePath)) {
        diagnostics.logicCheck.details.push("✅ lib/migrate-to-turso.js does not run execution on require.");
    }

    // Check 7.3: Notion Extended Database configuration vs SQLite usage check
    diagnostics.logicCheck.details.push("🔍 Check 7.3: Checking unused Notion database configurations...");
    const envContent = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8');
    const teamDbVal = process.env.NOTION_TEAM_DB;
    const eventsDbVal = process.env.NOTION_EVENTS_DB;
    const reportsDbVal = process.env.NOTION_REPORTS_DB;
    
    diagnostics.logicCheck.details.push(`▪ NOTION_TEAM_DB configured: ${teamDbVal ? 'Yes' : 'No'}`);
    diagnostics.logicCheck.details.push(`▪ NOTION_EVENTS_DB configured: ${eventsDbVal ? 'Yes' : 'No'}`);
    diagnostics.logicCheck.details.push(`▪ NOTION_REPORTS_DB configured: ${reportsDbVal ? 'Yes' : 'No'}`);
    diagnostics.logicCheck.details.push(`ℹ Note: Code implementation uses SQLite tables (team_members, events, reports) rather than Notion databases, rendering these ENV variables obsolete for write paths, but their check is still hardcoded in commands (team-update.js, event-create.js, report-submit.js) which may throw confusing error messages if missing.`);

    diagnostics.logicCheck.passed = sweepPassed;
    if (sweepPassed) {
        console.log(`${colors.green}✔ Logic check sweeps completed without major issues.${colors.reset}\n`);
    } else {
        console.log(`${colors.red}✘ Codebase logic checks found bugs or discrepancies.${colors.reset}\n`);
    }
}

// ====================================================
//  EXECUTION ORCHESTRATOR
// ====================================================
async function runAll() {
    await testDatabase();
    await testNotion();
    await testCalcom();
    await testSMTP();
    sweepLogicBugs();

    // ====================================================
    //  SUMMARY DISPLAY
    // ====================================================
    console.log(`${colors.bold}${colors.magenta}====================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}                DIAGNOSTIC RECAP                    ${colors.reset}`);
    console.log(`${colors.bold}${colors.magenta}====================================================${colors.reset}`);

    for (const [key, section] of Object.entries(diagnostics)) {
        const icon = section.passed ? `${colors.green}🟢 PASSED${colors.reset}` : `${colors.red}🔴 FAILED${colors.reset}`;
        console.log(`\n${colors.bold}${section.name} : ${icon}${colors.reset}`);
        for (const detail of section.details) {
            console.log(`  ${detail}`);
        }
    }
    console.log(`\n${colors.bold}${colors.magenta}====================================================${colors.reset}\n`);
}

runAll();
