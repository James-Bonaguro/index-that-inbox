# Index That Inbox: notes for coding agents

Private capture inbox for Index That, James's own private Instagram brand. It is not shared with anyone and is separate from the Kevin media brand and from James's personal notes. iOS Shortcuts and a backup PWA send captures to a Google Apps Script webhook, which appends them to the "Index That Inbox" Google Doc and saves images to that Doc's Drive folder.

## Read these first

| File | What it is |
|---|---|
| `README.md` | Architecture, payload, setup, deploy |
| `docs/workflow.html` | James's one-page day-to-day guide (capture, weekly review, fixes) |
| `ios-shortcut-guide.md` | How the two Shortcuts are built, step by step |
| `apps-script/Code.gs` | The webhook: parsing, key check, tags, Doc writing |
| `app.js`, `index.html`, `styles.css`, `sw.js` | The PWA |
| `shortcuts/build.py` | Generates and signs the two `.shortcut` files |
| `tests/` | `node --test tests/*.test.js` (30 tests, no dependencies) |

## Facts

- Live pieces: the PWA at index-that-inbox.vercel.app; a standalone Apps Script project "Index That Inbox", deployed as a web app; the Google Doc ID `1eAaWLjEZ37Mkoh-rfRr5e2Q9M-3CNYKw0-_GQKhqnLw` (james.bonaguro@gmail.com).
- The captured content lives in that Google Doc, not in this repo. Agents without Google access can't read it; ask James to export it or share the text.
- Entry format: a heading `[TAG] Platform · Day, Mon D, YYYY at H:MM AM`, then the title, URL, text or image link. Tags are `[NOTE]`, `[LINK]` and `[ASSET]`.
- Every request needs `INGEST_KEY`. It lives only in Apps Script Script Properties, Apple Passwords, the installed Shortcuts and the phone. Never ask for it, print it or commit it.
- The `upstream` remote is the old public apps-script-mobile-data-ingestion repo, with push disabled. Never push there.

## Rules

- Small PWA fixes (app.js, index.html, styles.css, sw.js) that pass the tests can be pushed to main without asking; Vercel deploys them. Ask James first for anything else: Apps Script changes or deploys, anything in Google, bigger features. Nothing gets permanently deleted.
- No npm dependencies, no build step. Keep the CSP in `vercel.json` strict.
- Plain language, no em dashes in copy James reads.
- After changing `Code.gs`, run the tests, then James redeploys: Manage deployments → edit → New version.
