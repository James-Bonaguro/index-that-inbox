# Index That Inbox

A private capture inbox for the Index That Instagram brand. Anything that catches your eye on the iPhone (a post, a link, a screenshot, a passing thought) goes into one Google Doc in a couple of taps. Claude Code, Gemini and other agents then read that Doc to build content.

No servers to run, no paid services, no dependencies, no build step.

## How it fits together

| Piece | Role |
|---|---|
| **iOS Shortcuts** (`ios-shortcut-guide.md`) | The main way in. "Index That" in the Share Sheet for posts, links and screenshots; "Index Thought" on Back Tap or the Action Button for voice. |
| **PWA** (`index.html`, `app.js`, `styles.css`, `sw.js`) | Dashboard and offline fallback. Captures save on the phone first and sync when a connection returns. |
| **Apps Script webhook** (`apps-script/Code.gs`) | One private endpoint for all of the above. Checks the key, tags each capture, writes it to the Doc, saves images to Drive. |
| **Google Doc + Drive folder** "Index That Inbox" | Where everything lands. Private to your account. |

Every entry gets a heading like `[LINK] Instagram · Mon, Oct 19, 2026 at 3:05 PM`:

- `[NOTE]`: text or dictation
- `[LINK]`: a URL, or text containing one (page title fetched when the sender has none)
- `[ASSET]`: an image, saved in the Doc's Drive folder and linked from the entry

The platform comes from the link's site (Instagram, X, TikTok, YouTube, LinkedIn, Threads, Reddit, or the bare domain). Captures without a link show as Voice, Screenshot or Note. The guide's "How AI readers use the inbox" section documents the exact entry format.

## Payload

`POST` JSON to the Apps Script `/exec` URL. The PWA sends `Content-Type: text/plain` to avoid a CORS preflight; Shortcuts send `application/json`. Both work.

| Field | Required | Notes |
|---|---|---|
| `key` | yes | Must match the `INGEST_KEY` script property |
| `type` | no | `text`, `url` or `image`. If missing: any image means `image`; a `url` field or text that is only a URL means `url`; otherwise `text` |
| `text` | for text | Up to 50,000 characters. Also allowed as a note on links and images |
| `url` | for url | `http(s)` only, up to 2,048 characters |
| `title` | no | Page title. If missing, the server tries to fetch it |
| `image` | for image | `{ "data": "<base64, no data: prefix>", "mimeType": "image/jpeg" }`, up to 10 MB |
| `source` | no | Where it came from: `pwa`, `share-sheet`, `dictation` |
| `id` | no | Any unique string. A repeat of the same `id` within 6 hours is not written twice |
| `createdAt` | no | ISO timestamp. Defaults to now |

The old PWA shape (`{ text, image: "data:image/jpeg;base64,..." }`) still works.

**Responses**

- Saved: `{ "ok": true, "id", "tag", "platform", "docUrl", "fileUrl" }`
- Wrong or missing key: `{ "ok": false, "retryable": false, "code": "unauthorized", "error": "Unauthorized" }`
- Bad payload: `{ "ok": false, "retryable": false, "error": "Invalid payload: ..." }`
- Temporary problem: `{ "ok": false, "retryable": true, "error": "..." }`

## Setup

**1. Google side**

1. In Google Drive (james.bonaguro@gmail.com), create a folder **Index That Inbox** and a Google Doc of the same name inside it. Share neither.
2. Go to [script.google.com](https://script.google.com) → **New project**. Name it "Index That Inbox". Replace `Code.gs` with `apps-script/Code.gs`.
3. Set `DOC_ID` to the Doc's ID (the long string in its URL between `/d/` and `/edit`).
4. **Project Settings** → **Script Properties** → add `INGEST_KEY` with a long passphrase only you know.
5. Choose the `authorize` function → **Run**, and approve access. The log should say `INGEST_KEY is set`.
6. **Deploy** → **New deployment** → type **Web app** → Execute as **Me**, Who has access **Anyone** → **Deploy**. Copy the `/exec` URL.
7. Open the `/exec` URL in a browser. It should show `{"ok":true,"service":"index-that-inbox",...}`.

"Anyone" only means anyone can reach the URL. Without the key, nothing gets written.

Later code changes: **Deploy** → **Manage deployments** → edit → **Version: New version**. This keeps the same URL.

**2. iPhone**

1. Build the two Shortcuts with `ios-shortcut-guide.md`.
2. Open the Vercel URL in Safari → Share → **Add to Home Screen**. Launch it from the icon, then paste the `/exec` URL and the key into the setup sheet. Edit them later with the gear button.

**3. Front-end deploy**

Static files on Vercel; no build settings. `vercel.json` sets a strict Content Security Policy. When you change `sw.js` or the list of cached files, bump `VERSION` in `sw.js`.

## Tests

```bash
node --test tests/*.test.js
```

They run `Code.gs` in Node with stand-ins for the Google services, covering parsing, tags, platforms, titles, the key check and the full save path, plus the PWA's capture-type helper. They don't replace one real capture on the phone after each deploy.

## Notes

- **Why there's no `doOptions`:** Apps Script never passes `OPTIONS` requests to the script, so the PWA sends a "simple" `text/plain` request instead.
- **Why the key is in the body:** Apps Script can't read request headers.
- **Why no Tailwind:** the CSP allows only same-origin scripts and styles, and the hand-written iOS design system in `styles.css` already covers the UI. A CDN framework would mean loosening the CSP.
- **iOS:** web dictation needs a network (Apple does the recognition), there's no background sync, and the PWA can't appear in the Share Sheet. That's why the Shortcuts carry most of the load.
- **Origin:** started from [apps-script-mobile-data-ingestion](https://github.com/James-Bonaguro/apps-script-mobile-data-ingestion), kept as the `upstream` remote with pushes disabled. That project is separate and unchanged.
