# Mac Inbox design (approved Nov 25, 2026)

## Context

James stopped using the Index That Inbox. Two things broke it for him, and the brand it served is gone:

1. **Logging in again every time.** The PWA keeps the webhook URL and key in the iPhone's browser storage, and something on the phone keeps clearing it (most likely Safari's Block All Cookies setting; the setup sheet already warns about this). The two Shortcuts never have this problem because the key lives inside them.
2. **Too many tabs when reviewing.** The Doc has 12 captures (Oct 20 to Nov 9): 8 screenshots, 3 notes (2 of them tests) and 1 link. Each screenshot appears only as a "📎 Image" link to a Drive file, so reviewing means opening a new tab for every capture.
3. **Index That is retired.** The Magpie approach (about 3,000 saves sorted into pillars) didn't work. What is working is a new Instagram page about Mac and iOS updates, made with Muse. James says he hoards archives, so building a better archive is the wrong goal.

**Decided (James, this session):** the inbox now feeds the Mac/iOS page. Every capture is a post candidate. Muse can read it, and anything older than about 2 weeks moves out of the way.

## Approaches

- **A. Keep the Shortcut-to-Doc setup and fix the Doc (chosen).** The Shortcuts post to Apps Script, which writes a new "Mac Inbox" Doc: screenshots shown in the Doc itself, a one-line summary for links, newest entries first, and a daily move of anything older than 14 days into an archive Doc. Muse and Claude can both read it. Cost: one Code.gs update that James pastes in and redeploys.
- B. Shortcuts save to Apple Notes. No code at all, but Muse and Claude can't read Apple Notes, so nothing gets turned into posts.
- C. A review page in the PWA with Use and Drop buttons. A nicer screen, but it has to read from Google, which brings back the login problem we're removing.

## Design

**Capture: Shortcuts only, no login.**
- "Index That" (Share Sheet) and "Index Thought" (Back Tap and voice) keep the same webhook URL and key, so they keep working with nothing to reinstall. James can rename them on the phone to **Mac Inbox** and **Mac Idea** (optional, 30 seconds).
- The PWA is no longer a daily tool. Its code stays as it is, as an offline backup. If James ever wants it back, the fix to check is Settings > Apps > Safari > Block All Cookies.

**Where captures land: a new "Mac Inbox" Doc** in a new "Mac Inbox" folder under `10_ACTIVE PROJECTS` in Drive, plus a "Mac Inbox Archive" Doc in the same folder. I'll create these with the Drive connector. The old Index That Doc and folder stay exactly as they are.

**Changes to `apps-script/Code.gs`** (the webhook):
1. **Newest first.** Entries go in below a short note at the top of the Doc ("Newest first. Entries older than 14 days move to Mac Inbox Archive."), not at the bottom. This uses Docs' `body.insertParagraph`, `insertImage` and `insertHorizontalRule` at a child index instead of the `append*` calls that `appendParagraph_` and `appendLink_` make today.
2. **Screenshots in the Doc.** The image is still saved to the Drive folder (as `ingest_` does now). The picture is also placed in the entry (`insertImage`, about 300 px wide, height kept in proportion), and the existing "📎 Image" link stays underneath so an AI can open the full-size file.
3. **Link summaries.** Turn `extractTitle_` into `extractMeta_`, which returns `{ title, description }` (og:title then `<title>`, plus og:description then the `description` meta tag, using the same entity decoding, with the description capped at 300 characters). `doPost` fetches link pages whenever it needs either value, before taking the lock as it does now. A title the sender provided still wins. The description goes on its own line under the title. Instagram and X will still often give nothing, which is fine.
4. **14-day auto-archive.** New `archiveOld()`, run daily by a time-based trigger, under the script lock. It groups the Doc into entries (a Heading 3 that starts with `[NOTE]`, `[LINK]` or `[ASSET]`, through to the next horizontal rule), reads the date from the heading (`Mon, Oct 19, 2026`), copies each old entry's paragraphs into the archive Doc with `paragraph.copy()` (pictures come along), and removes them from the inbox only after the copy succeeds. It always keeps the top note, so the Doc is never left with no paragraphs, which Docs doesn't allow. Nothing is deleted permanently.
5. **Setup.** Change `DOC_ID` to the new Doc's ID and add `ARCHIVE_DOC_ID`. `authorize()` also checks it can open the archive Doc and installs the daily trigger (it removes any older copy first, so running it twice is safe). `INGEST_KEY`, the payload, the reply format (including `tag`, which the Shortcuts read) and the deployment URL all stay the same.

**Turning captures into posts: Muse, on request.** This adds nothing to build, and it keeps the page "just Muse", as James wants. The full prompt James pastes into Muse:

> Open my Google Doc called "Mac Inbox". It holds things I saved in the last two weeks for my Mac and iOS Instagram page, newest first. [NOTE] is my own thought, [LINK] is an article or post, and [ASSET] is a screenshot (the picture is in the Doc, and the link under it opens the full image). Give me the 3 strongest post ideas from it. For each one: the hook, the format (carousel or reel), which entries it uses, and why someone with an iPhone or Mac would save it or send it to a friend. Skip anything that is already old news. Don't invent features, dates or facts that aren't in the entries or on Apple's own pages.

**Docs in the repo:** update `README.md` and `AGENTS.md` for the new purpose and the new Doc. Rewrite `docs/workflow.html` as a short Mac Inbox guide (capture moves, the Muse prompt, what to do if something breaks) and republish its private artifact. Rename the mentions in `ios-shortcut-guide.md` and add the step for renaming the Shortcuts. Plain language, no em dashes.

**Not changing:** the PWA files, `vercel.json`, `shortcuts/build.py` and the signed `.shortcut` files (rebuilding those needs the Mac), the repo name, the Magpie and be.friends.again setup.

**Later, only if James actually runs into it:** sending several screenshots in one share (the Shortcut sends only the first; fixing it needs `build.py` run on the Mac), and adding preview images to link entries.

## Steps

1. Save this design to `docs/superpowers/specs/2026-11-25-mac-inbox-design.md` on branch `claude/happy-allen-fpgbjt`, then write the implementation plan (writing-plans) and work through it test-first.
2. Tests first, in `tests/code.test.js`: grow the `fakeWorkspace()` fake to support index-based inserts, `insertImage` and child elements. New tests cover: entries go in below the top note, newest first; a screenshot entry includes the inline picture and the Drive link; `extractMeta_` returns the description and decodes entities; a sender's title beats the fetched one; `archiveOld` moves only entries older than 14 days, keeps the top note, and leaves the inbox untouched if copying fails; the heading date parses. All 30 existing tests still pass (update the ones that assume entries are appended at the bottom).
3. Implement the Code.gs changes and run `node --test tests/*.test.js`.
4. Create the "Mac Inbox" folder and the two Docs through the Drive connector, and put their IDs in Code.gs.
5. Update the docs, commit, push, and open a draft PR.

## What James does (about 5 minutes, on the computer)

1. In the Apps Script project, replace Code.gs with the new version.
2. Run `authorize` once and approve if Google asks. The log should name both Docs and say the trigger is installed.
3. Deploy > Manage deployments > edit > Version: New version. The URL stays the same, so the Shortcuts keep working.
4. Optional: rename the Shortcuts on the phone and delete the old Inbox app icon from the Home Screen.

## Verification

- `node --test tests/*.test.js`: everything passes.
- Open the `/exec` URL: the health check returns `ok: true`.
- From the phone: share a screenshot (it shows at the top of Mac Inbox as a picture), share an Apple Newsroom or MacRumors link (title and a one-line summary), and say a thought with Back Tap (a [NOTE] entry). I'll read the Doc through the Google Docs connector to confirm the layout.
- Run `archiveOld` once from the editor: the log reports 0 moved (nothing is 14 days old yet), and the Docs are unchanged.
- Paste the Muse prompt into Muse and confirm it can open Mac Inbox and see the entries.
