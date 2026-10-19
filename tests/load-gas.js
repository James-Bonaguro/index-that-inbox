'use strict';

// Runs apps-script/Code.gs in a sandbox with stubbed Apps Script services so its helpers can be tested in Node.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function loadGas(stubs = {}) {
    const properties = stubs.properties || {};
    const context = {
        console,
        PropertiesService: {
            getScriptProperties: () => ({ getProperty: (name) => (name in properties ? properties[name] : null) }),
        },
        Session: { getScriptTimeZone: () => 'America/Chicago' },
        Utilities: {
            formatDate: (date, tz, pattern) => `${pattern}|${date.toISOString()}`,
            base64Decode: (data) => Buffer.from(data, 'base64'),
        },
        ContentService: {
            MimeType: { JSON: 'json' },
            createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
        },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
        ...stubs.globals,
    };
    vm.createContext(context);
    // A real-looking DOC_ID gets past the "not set up yet" guard in doPost.
    const source = stubs.docId ? SOURCE.replace("'PASTE_YOUR_GOOGLE_DOC_ID_HERE'", JSON.stringify(stubs.docId)) : SOURCE;
    vm.runInContext(source, context);
    return context;
}

/** Builds the event object Apps Script passes to doPost. */
function post(payload) {
    return { postData: { contents: JSON.stringify(payload) } };
}

module.exports = { loadGas, post };
