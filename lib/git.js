const { execSync } = require('child_process');

/**
 * Fetches current Git commit information.
 * @returns {Object} Git info including hash, title, and author.
 */
function getGitInfo() {
    try {
        const hash = execSync('git rev-parse --short HEAD').toString().trim();
        const title = execSync('git log -1 --pretty=%s').toString().trim();
        const author = execSync('git log -1 --pretty=%an').toString().trim();
        
        return {
            hash,
            title,
            author,
            available: true
        };
    } catch (error) {
        console.error('[GIT ERROR] Failed to fetch git info:', error.message);
        return {
            hash: 'unknown',
            title: 'unknown',
            author: 'unknown',
            available: false
        };
    }
}

module.exports = { getGitInfo };
