const fs = require('fs');
const path = require('path');

// Read on each call so a version bump shows up without restarting the server.
function appVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version;
    } catch (e) {
        return null;
    }
}

module.exports = { appVersion };
