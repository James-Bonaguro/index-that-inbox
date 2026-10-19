'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, post } = require('./load-gas');

const gas = loadGas();
const parse = (payload) => gas.parseCapture_(post(payload));

// --- Payload parsing and tags ----------------------------------------------

test('legacy PWA payload parses as image', () => {
    const c = parse({ id: 'a', text: '', image: { data: 'AAAA', mimeType: 'image/jpeg' } });
    assert.equal(c.type, 'image');
    assert.equal(gas.tagFor_(c), '[ASSET]');
});

test('legacy data-URL image still parses', () => {
    const c = parse({ text: 'look', image: 'data:image/png;base64,AAAA' });
    assert.equal(c.type, 'image');
    assert.equal(c.image.mimeType, 'image/png');
});

test('bare url text infers url type', () => {
    const c = parse({ text: 'https://www.instagram.com/p/abc/' });
    assert.equal(c.type, 'url');
    assert.equal(c.url, 'https://www.instagram.com/p/abc/');
    assert.equal(c.text, '');
    assert.equal(gas.tagFor_(c), '[LINK]');
});

test('text containing a link stays text but tags LINK', () => {
    const c = parse({ text: 'so good https://x.com/a/status/1' });
    assert.equal(c.type, 'text');
    assert.equal(gas.tagFor_(c), '[LINK]');
});

test('plain text tags NOTE', () => {
    const c = parse({ type: 'text', text: 'hook idea' });
    assert.equal(gas.tagFor_(c), '[NOTE]');
});

test('url type keeps title, note text and source', () => {
    const c = parse({ type: 'url', url: 'https://x.com/a/status/1', title: 'A post', text: 'steal this format', source: 'share-sheet' });
    assert.equal(c.type, 'url');
    assert.equal(c.title, 'A post');
    assert.equal(c.text, 'steal this format');
    assert.equal(c.source, 'share-sheet');
});

test('url type rejects non-http', () => {
    assert.throws(() => parse({ type: 'url', url: 'javascript:alert(1)' }), /url must be http/);
});

test('unknown type falls back to inference', () => {
    assert.equal(parse({ type: 'video', text: 'hello' }).type, 'text');
});

test('empty capture rejected', () => {
    assert.throws(() => parse({ type: 'text', text: '  ' }), /nothing to save/);
});

test('source defaults to unknown and is capped', () => {
    assert.equal(parse({ text: 'x' }).source, 'unknown');
    assert.equal(parse({ text: 'x', source: 'y'.repeat(100) }).source.length, 40);
});

// --- Key check --------------------------------------------------------------

test('isAuthorized_ fails closed', () => {
    assert.equal(gas.isAuthorized_('k', null), false);
    assert.equal(gas.isAuthorized_('', ''), false);
    assert.equal(gas.isAuthorized_('k', 'k'), true);
    assert.equal(gas.isAuthorized_('k', 'K'), false);
});

test('doPost rejects a wrong key before touching Drive or Docs', () => {
    const untouchable = new Proxy({}, { get() { throw new Error('Drive/Docs touched'); } });
    const locked = loadGas({
        properties: { INGEST_KEY: 'secret' },
        globals: { DriveApp: untouchable, DocumentApp: untouchable },
    });
    const res = JSON.parse(locked.doPost(post({ text: 'hi', key: 'nope' })).text);
    assert.equal(res.ok, false);
    assert.equal(res.retryable, false);
    assert.equal(res.code, 'unauthorized');
});

test('doPost rejects everything when no key is configured', () => {
    const res = JSON.parse(gas.doPost(post({ text: 'hi', key: '' })).text);
    assert.equal(res.code, 'unauthorized');
});

// --- Platform, titles, headings ---------------------------------------------

test('platformFor_ names the source of a link', () => {
    assert.equal(gas.platformFor_(parse({ text: 'https://www.instagram.com/p/abc/' })), 'Instagram');
    assert.equal(gas.platformFor_(parse({ text: 'lol https://x.com/a/status/1' })), 'X');
    assert.equal(gas.platformFor_(parse({ text: 'https://twitter.com/a/status/1' })), 'X');
    assert.equal(gas.platformFor_(parse({ text: 'https://youtu.be/abc' })), 'YouTube');
    assert.equal(gas.platformFor_(parse({ text: 'https://lnkd.in/abc' })), 'LinkedIn');
    assert.equal(gas.platformFor_(parse({ text: 'https://www.example.com/a' })), 'example.com');
});

test('platformFor_ without a link uses the capture kind', () => {
    assert.equal(gas.platformFor_(parse({ text: 'idea', source: 'dictation' })), 'Voice');
    assert.equal(gas.platformFor_(parse({ image: { data: 'AAAA', mimeType: 'image/jpeg' } })), 'Screenshot');
    assert.equal(gas.platformFor_(parse({ text: 'idea', source: 'pwa' })), 'Note');
});

test('extractTitle_ reads og:title first, then <title>', () => {
    assert.equal(gas.extractTitle_('<html><title> A &amp; B </title>'), 'A & B');
    assert.equal(gas.extractTitle_('<title>Plain</title><meta property="og:title" content="OG &quot;x&quot;">'), 'OG "x"');
    assert.equal(gas.extractTitle_('<meta content="Rev" property="og:title">'), 'Rev');
    assert.equal(gas.extractTitle_(''), null);
    assert.equal(gas.extractTitle_('<title>   </title>'), null);
    assert.equal(gas.extractTitle_(`<title>${'t'.repeat(400)}</title>`).length, 300);
});

test('headingText_ is TAG, platform, then time', () => {
    const heading = gas.headingText_(parse({ text: 'idea', source: 'dictation' }), 'America/Chicago');
    assert.match(heading, /^\[NOTE\] Voice · /);
    const link = gas.headingText_(parse({ text: 'https://www.instagram.com/p/abc/' }), 'America/Chicago');
    assert.match(link, /^\[LINK\] Instagram · /);
});

// --- Full save path with fake Docs/Drive ------------------------------------

function fakeWorkspace({ fetch } = {}) {
    const written = [];
    const paragraph = (text) => {
        const p = { text, link: null, heading: null };
        written.push(p);
        const api = {
            setHeading(h) { p.heading = h; return api; },
            setLinkUrl(url) { if (url) p.link = url; return api; },
            editAsText() { return { setLinkUrl: (s, e, url) => { p.link = url; return api; } }; },
        };
        return api;
    };
    const docFile = { getUrl: () => 'https://docs/doc', getParents: () => ({ hasNext: () => false }) };
    const globals = {
        DriveApp: {
            getFileById: () => docFile,
            getRootFolder: () => ({ createFile: (blob) => ({ getName: () => blob.name, getUrl: () => 'https://drive/' + blob.name }) }),
        },
        DocumentApp: {
            ParagraphHeading: { HEADING3: 'H3', NORMAL: 'N' },
            openById: () => ({
                getBody: () => ({ appendParagraph: paragraph, appendHorizontalRule: () => written.push({ text: '---' }) }),
                saveAndClose() {},
            }),
        },
        UrlFetchApp: { fetch: fetch || (() => { throw new Error('blocked'); }) },
    };
    globals.Utilities = {
        formatDate: (d) => 'Mon, Oct 19, 2026 at 3:05 PM',
        base64Decode: (s) => Buffer.from(s, 'base64'),
        newBlob: (bytes, type, name) => ({ name }),
    };
    return { written, gas: loadGas({ properties: { INGEST_KEY: 'k' }, globals }) };
}

test('link saves even when the title fetch fails', () => {
    const { written, gas: g } = fakeWorkspace();
    const res = JSON.parse(g.doPost(post({ type: 'url', url: 'https://www.instagram.com/p/abc/', source: 'share-sheet', key: 'k' })).text);
    assert.equal(res.ok, true);
    assert.equal(res.tag, '[LINK]');
    assert.equal(res.platform, 'Instagram');
    assert.equal(written[0].text, '[LINK] Instagram · Mon, Oct 19, 2026 at 3:05 PM');
    assert.equal(written[1].text, 'Instagram post');
    assert.equal(written[1].link, 'https://www.instagram.com/p/abc/');
    assert.equal(written[2].text, 'https://www.instagram.com/p/abc/');
});

test('fetched title is used when the sender sends none', () => {
    const { written, gas: g } = fakeWorkspace({
        fetch: () => ({ getResponseCode: () => 200, getContentText: () => '<title>Great Reel</title>' }),
    });
    g.doPost(post({ text: 'https://example.com/a', key: 'k' }));
    assert.equal(written[1].text, 'Great Reel');
});

test('Shortcuts "Get Name" echoing the URL is not treated as a title', () => {
    const c = parse({ type: 'url', url: 'https://x.com/a/status/1', title: 'https://x.com/a/status/1' });
    assert.equal(c.title, null);
});

test('screenshot saves to Drive and links from the Doc', () => {
    const { written, gas: g } = fakeWorkspace();
    const res = JSON.parse(g.doPost(post({ id: 'abcdef123', type: 'image', image: { data: 'AAAA', mimeType: 'image/jpeg' }, source: 'share-sheet', key: 'k' })).text);
    assert.equal(res.tag, '[ASSET]');
    assert.match(written[0].text, /^\[ASSET\] Screenshot · /);
    assert.match(written[1].text, /^📎 Image: capture-.*-abcdef12\.jpg$/);
    assert.ok(written[1].link.startsWith('https://drive/'));
});
