/**
 * Index That Inbox: Google Apps Script backend.
 *
 * One private webhook for every capture source: the PWA, the iOS Share Sheet Shortcut and the
 * dictation Shortcut. Each capture is appended to the inbox Google Doc under a tagged heading:
 *   [NOTE]  plain text or dictation
 *   [LINK]  a URL, or text that contains one (page title fetched when the sender has none)
 *   [ASSET] an image, saved as a file in the Drive folder that holds the Doc
 *
 * Setup: set DOC_ID below, then Project Settings → Script Properties → add INGEST_KEY (a passphrase).
 * Every request must send the same value as "key" in its JSON body. With no INGEST_KEY set,
 * every request is rejected. Run authorize() once, then Deploy → New deployment → Web app,
 * Execute as "Me", Who has access "Anyone". Later code changes: Manage deployments → edit → New version.
 *
 * CORS: Apps Script never passes OPTIONS requests to the script, so the PWA POSTs with
 * Content-Type: text/plain (no preflight). Shortcuts aren't subject to CORS and may send JSON.
 * Apps Script can't read request headers, which is why the key travels in the body.
 */

// ID of the inbox Google Doc (the long string in its URL: /document/d/<ID>/edit).
const DOC_ID = 'PASTE_YOUR_GOOGLE_DOC_ID_HERE';

const KEY_PROPERTY = 'INGEST_KEY';
const DEDUPE_TTL_SECONDS = 6 * 60 * 60; // Offline retries with the same id are ignored for 6h.
const LOCK_TIMEOUT_MS = 20000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 50000;
const MAX_URL_CHARS = 2048;
const MAX_TITLE_CHARS = 300;
const MAX_SOURCE_CHARS = 40;
const MAX_HTML_CHARS = 200000;
const LEGACY_IMAGE_PLACEHOLDER = '[Image Attached - No Text]';
const TYPES = ['text', 'image', 'url'];
const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
const ONLY_A_URL = /^https?:\/\/\S+$/i;

const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

// Host suffix → platform name used in headings. Anything else shows its bare host.
const PLATFORMS = [
  ['instagram.com', 'Instagram'],
  ['x.com', 'X'],
  ['twitter.com', 'X'],
  ['tiktok.com', 'TikTok'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['linkedin.com', 'LinkedIn'],
  ['lnkd.in', 'LinkedIn'],
  ['threads.net', 'Threads'],
  ['threads.com', 'Threads'],
  ['reddit.com', 'Reddit'],
];

/** Health check: open the /exec URL in a browser to confirm the deployment is live. */
function doGet() {
  return json_({ ok: true, service: 'index-that-inbox', time: new Date().toISOString() });
}

function doPost(e) {
  let capture;
  try {
    capture = parseCapture_(e);
  } catch (err) {
    return json_({ ok: false, retryable: false, error: 'Invalid payload: ' + errorMessage_(err) });
  }

  const expectedKey = PropertiesService.getScriptProperties().getProperty(KEY_PROPERTY);
  if (!isAuthorized_(capture.key, expectedKey)) {
    return json_({ ok: false, retryable: false, code: 'unauthorized', error: 'Unauthorized' });
  }

  // Fetched before taking the lock so a slow site never blocks other captures.
  if (capture.type === 'url' && !capture.title) capture.title = fetchTitle_(capture.url);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (err) {
    return json_({ ok: false, retryable: true, error: 'Server busy, try again' });
  }

  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = capture.id ? 'capture:' + capture.id : null;
    if (cacheKey) {
      const previous = cache.get(cacheKey);
      if (previous) return json_(Object.assign(JSON.parse(previous), { duplicate: true }));
    }

    const result = ingest_(capture);
    if (cacheKey) cache.put(cacheKey, JSON.stringify(result), DEDUPE_TTL_SECONDS);
    return json_(result);
  } catch (err) {
    console.error(err);
    return json_({ ok: false, retryable: true, error: errorMessage_(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Accepts
 *   { type?, id?, createdAt?, text?, url?, title?, image?: { data, mimeType }, source?, key }
 * and the legacy PWA shape
 *   { text, image: "data:image/jpeg;base64,..." | { data, mimeType }, timestamp }.
 * Any image makes it "image". Otherwise a missing or unknown type is inferred:
 * a url field, or text that is a single URL → "url"; anything else → "text".
 */
function parseCapture_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('empty body');
  const payload = JSON.parse(e.postData.contents);

  let text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (text === LEGACY_IMAGE_PLACEHOLDER) text = '';
  if (text.length > MAX_TEXT_CHARS) throw new Error('text too long');

  let image = null;
  if (typeof payload.image === 'string' && payload.image) {
    const match = payload.image.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error('image is not a base64 data URL');
    image = { mimeType: match[1], data: match[2] };
  } else if (payload.image && typeof payload.image === 'object') {
    image = { mimeType: String(payload.image.mimeType || 'image/jpeg'), data: String(payload.image.data || '') };
  }
  if (image) {
    if (!/^image\//.test(image.mimeType)) throw new Error('unsupported image type ' + image.mimeType);
    if (!image.data) throw new Error('image data missing');
  }

  let url = typeof payload.url === 'string' ? payload.url.trim() : '';
  let type = TYPES.indexOf(payload.type) >= 0 ? payload.type : null;
  if (image) type = 'image';
  else if (type === 'image') throw new Error('image data missing');
  else if (!type) type = url || ONLY_A_URL.test(text) ? 'url' : 'text';

  if (type === 'url') {
    if (!url && ONLY_A_URL.test(text)) {
      url = text;
      text = '';
    } else if (!url) {
      url = (text.match(URL_IN_TEXT) || [''])[0];
    }
    if (!/^https?:\/\//i.test(url)) throw new Error('url must be http(s)');
    if (url.length > MAX_URL_CHARS) throw new Error('url too long');
  } else {
    url = '';
  }

  if (!text && !image && !url) throw new Error('nothing to save');

  let createdAt = new Date(payload.createdAt || payload.timestamp || Date.now());
  if (isNaN(createdAt.getTime())) createdAt = new Date();

  const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, MAX_TITLE_CHARS) : '';
  const source = typeof payload.source === 'string' ? payload.source.trim().slice(0, MAX_SOURCE_CHARS) : '';

  return {
    id: payload.id ? String(payload.id).slice(0, 100) : null,
    createdAt: createdAt,
    type: type,
    text: text,
    url: url || null,
    // Shortcuts' "Get Name" falls back to the URL itself when a page has no name; that isn't a title.
    title: title && title !== url ? title : null,
    image: image,
    source: source || 'unknown',
    key: typeof payload.key === 'string' ? payload.key : '',
  };
}

/** Fails closed: no key configured means nobody gets in. */
function isAuthorized_(providedKey, expectedKey) {
  if (!expectedKey) return false;
  return providedKey === expectedKey;
}

function tagFor_(capture) {
  if (capture.image) return '[ASSET]';
  if (capture.type === 'url' || URL_IN_TEXT.test(capture.text || '')) return '[LINK]';
  return '[NOTE]';
}

/** Where the capture came from: the linked site, or the kind of capture when there is no link. */
function platformFor_(capture) {
  const found = capture.url || ((capture.text || '').match(URL_IN_TEXT) || [])[0];
  const hostMatch = found ? found.match(/^https?:\/\/([^\/?#:]+)/i) : null;
  if (hostMatch) {
    const host = hostMatch[1].toLowerCase().replace(/^(www|m|mobile)\./, '');
    for (let i = 0; i < PLATFORMS.length; i++) {
      const suffix = PLATFORMS[i][0];
      if (host === suffix || host.slice(-(suffix.length + 1)) === '.' + suffix) return PLATFORMS[i][1];
    }
    return host;
  }
  if (capture.source === 'dictation') return 'Voice';
  if (capture.image) return 'Screenshot';
  return 'Note';
}

/** "[LINK] Instagram · Mon, Oct 19, 2026 at 3:05 PM": tag and platform lead so AI readers can filter on them. */
function headingText_(capture, tz) {
  return tagFor_(capture) + ' ' + platformFor_(capture) + ' · ' +
    Utilities.formatDate(capture.createdAt, tz, "EEE, MMM d, yyyy 'at' h:mm a");
}

/** og:title first (social sites set it even when <title> is generic), then <title>. */
function extractTitle_(html) {
  if (!html) return null;
  let raw = null;
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (let i = 0; i < metas.length && raw === null; i++) {
    if (!/(?:property|name)\s*=\s*["']og:title["']/i.test(metas[i])) continue;
    const content = metas[i].match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (content) raw = content[1] !== undefined ? content[1] : content[2];
  }
  if (raw === null) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    raw = title ? title[1] : null;
  }
  if (raw === null) return null;
  const clean = raw
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, MAX_TITLE_CHARS) : null;
}

/** Best effort: many social sites hide titles from servers, so any failure just means no title. */
function fetchTitle_(url) {
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) return null;
    return extractTitle_(res.getContentText().slice(0, MAX_HTML_CHARS));
  } catch (err) {
    console.warn('Title fetch failed for ' + url + ': ' + errorMessage_(err));
    return null;
  }
}

function ingest_(capture) {
  const tz = Session.getScriptTimeZone();
  const docFile = DriveApp.getFileById(DOC_ID);

  let imageFile = null;
  if (capture.image) {
    const bytes = Utilities.base64Decode(capture.image.data);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image larger than 10 MB');
    const extension = IMAGE_EXTENSIONS[capture.image.mimeType] || 'img';
    const name = 'capture-' + Utilities.formatDate(capture.createdAt, tz, 'yyyy-MM-dd_HHmmss') +
      (capture.id ? '-' + capture.id.slice(0, 8) : '') + '.' + extension;
    const parents = docFile.getParents();
    const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    imageFile = folder.createFile(Utilities.newBlob(bytes, capture.image.mimeType, name));
  }

  const doc = DocumentApp.openById(DOC_ID);
  const body = doc.getBody();
  const platform = platformFor_(capture);

  appendParagraph_(body, headingText_(capture, tz), DocumentApp.ParagraphHeading.HEADING3);

  if (capture.url) {
    appendLink_(body, capture.title || platform + ' post', capture.url);
    appendParagraph_(body, capture.url, DocumentApp.ParagraphHeading.NORMAL);
  }

  if (capture.text) {
    appendParagraph_(body, capture.text, DocumentApp.ParagraphHeading.NORMAL);
  }

  if (imageFile) {
    appendLink_(body, '📎 Image: ' + imageFile.getName(), imageFile.getUrl());
  }

  body.appendHorizontalRule();
  doc.saveAndClose();

  return {
    ok: true,
    id: capture.id,
    tag: tagFor_(capture),
    platform: platform,
    docUrl: docFile.getUrl(),
    fileUrl: imageFile ? imageFile.getUrl() : null,
  };
}

/** Run once from the editor (select "authorize" → Run) to grant Docs, Drive and outbound-fetch access. */
function authorize() {
  const docFile = DriveApp.getFileById(DOC_ID);
  const parents = docFile.getParents();
  DocumentApp.openById(DOC_ID);
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  const keySet = Boolean(PropertiesService.getScriptProperties().getProperty(KEY_PROPERTY));
  console.log('Doc: ' + docFile.getName() + ' | Folder: ' + (parents.hasNext() ? parents.next().getName() : 'My Drive') +
    ' | ' + KEY_PROPERTY + (keySet ? ' is set' : ' is NOT set, so every capture will be rejected'));
}

// Docs copies the previous paragraph's style onto appended ones, so reset heading and link each time.
function appendParagraph_(body, text, heading) {
  return body.appendParagraph(text).setHeading(heading).setLinkUrl(null);
}

function appendLink_(body, label, url) {
  return appendParagraph_(body, label, DocumentApp.ParagraphHeading.NORMAL)
    .editAsText().setLinkUrl(0, label.length - 1, url);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorMessage_(err) {
  return String((err && err.message) || err);
}
