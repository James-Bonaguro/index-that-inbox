'use strict';

// Loads only the pure helpers at the top of app.js (everything above the "@pure-end" marker).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const end = source.indexOf('// @pure-end');
const context = {};
vm.createContext(context);
vm.runInContext(end >= 0 ? source.slice(0, end) : '', context);

test('captureType mirrors the server inference', () => {
    assert.equal(typeof context.captureType, 'function');
    assert.equal(context.captureType('https://a.b/c', false), 'url');
    assert.equal(context.captureType('  https://www.instagram.com/p/x/  ', false), 'url');
    assert.equal(context.captureType('see https://a.b', false), 'text');
    assert.equal(context.captureType('hook idea', false), 'text');
    assert.equal(context.captureType('', true), 'image');
    assert.equal(context.captureType('https://a.b', true), 'image');
});

test('isWebhookUrl accepts only Apps Script web app URLs', () => {
    assert.equal(context.isWebhookUrl('https://script.google.com/macros/s/AKfy_cb-12/exec'), true);
    assert.equal(context.isWebhookUrl('https://script.google.com/a/macros/example.com/s/AKfy/exec'), true);
    assert.equal(context.isWebhookUrl('https://script.google.com/macros/s/AKfy/dev'), false);
    assert.equal(context.isWebhookUrl('https://evil.example/macros/s/AKfy/exec'), false);
    assert.equal(context.isWebhookUrl('http://script.google.com/macros/s/AKfy/exec'), false);
});
