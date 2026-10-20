# Index That: iPhone Shortcuts

Two Shortcuts send captures straight to the Index That Inbox. You never open an app.

| Shortcut | What it catches | How you trigger it |
|---|---|---|
| **Index That** | Instagram and X posts, links, Safari pages, screenshots, photos, selected text | Share button → Index That |
| **Index Thought** | A thought, spoken | Double-tap the back of the phone, the Action Button, or "Hey Siri, Index Thought" |

**Fastest install:** on the Mac, double-click the two files in `shortcuts/`, choose Add Shortcut and paste your key when asked; iCloud syncs them to the iPhone. Then only Back Tap (below) is left to set on the phone. The rest of this guide shows how they're built, for repairs.

Both send to the same Apps Script web app as the PWA. Each capture lands in the inbox Doc under a heading like `[LINK] Instagram · Mon, Oct 19, 2026 at 3:05 PM`.

## Before you start

You need two things from the Apps Script setup (see the README):

1. **Web app URL.** It starts with `https://script.google.com/macros/s/` and ends with `/exec`.
2. **Key.** The value you saved as `INGEST_KEY` in Apps Script → Project Settings → Script Properties.

The key goes inside both Shortcuts. If you ever share a Shortcut, delete the key from it first.

---

## Shortcut A: "Index That" (Share Sheet)

### 1. Create it and put it in the Share Sheet

1. Open **Shortcuts** → tap **+**. Name it **Index That**.
2. Tap the **(i)** (or the name at the top) → turn on **Show in Share Sheet**.
3. At the top of the editor, set the input to receive **Images**, **URLs**, **Safari web pages** and **Text**. Turn everything else off.
4. Set "If there's no input" to **Stop and Respond**.

### 2. Store the URL and key

1. Add **Text** → paste your web app URL. Add **Set Variable** → name it `Webhook`.
2. Add **Text** → paste your key. Add **Set Variable** → name it `Key`.

Links are checked **before** images on purpose. When you share a Safari page, "Get Images from Input" would grab the page's pictures and lose the link.

### 3. Links (Instagram, X, Safari, anything with a URL)

1. Add **Get URLs from Input** (input: Shortcut Input).
2. Add **If** → `URLs` **has any value**. This is the **outer If**.
3. Inside it:
   - **Get Item from List** → First Item of `URLs`
   - **Get Name** of Shortcut Input (for Safari pages this is the page title)
   - **Get Contents of URL** → URL: `Webhook`. Tap Show More: Method **POST**, Request Body **JSON**, then add these fields:

| Key | Type | Value |
|---|---|---|
| `type` | Text | `url` |
| `url` | Text | Item from List |
| `title` | Text | Name |
| `text` | Text | Shortcut Input |
| `source` | Text | `share-sheet` |
| `key` | Text | `Key` variable |

`text` carries any caption you shared along with the link (for example "steal this hook https://..."). When the shared item is just the link, the server drops the duplicate. If an app has no real title, Get Name returns the URL. The server ignores that and uses the platform name instead.

### 4. Images (screenshots and photos)

1. Under the outer If's **Otherwise**, add **Get Images from Input** (input: Shortcut Input).
2. Add **If** → `Images` **has any value**. This is the **inner If**.
3. Inside it, add these in order:
   - **Get Item from List** → First Item of `Images` (one image per capture)
   - **Resize Image** → by **Longest Edge**, **1600**. Screenshots are already under 1600 wide, so this only shrinks large photos. If your iOS version only offers width and height, skip this step for screenshots; the server takes up to 10 MB.
   - **Convert Image** → to **JPEG**. Keep this as the last image step: it turns iPhone HEIC photos into JPEG, and the server is told the file is a JPEG.
   - **Base64 Encode** → tap Show More → **Line Breaks: None**
   - **Get Contents of URL** → URL: `Webhook`, Method **POST**, Request Body **JSON**:

| Key | Type | Value |
|---|---|---|
| `type` | Text | `image` |
| `source` | Text | `share-sheet` |
| `key` | Text | `Key` variable |
| `image` | Dictionary | `data` (Text) = Base64 Encoded result; `mimeType` (Text) = `image/jpeg` |

### 5. Plain text

1. Under the inner If's **Otherwise**, add **Get Contents of URL** → URL: `Webhook`, Method **POST**, Request Body **JSON**:

| Key | Type | Value |
|---|---|---|
| `type` | Text | `text` |
| `text` | Text | Shortcut Input |
| `source` | Text | `share-sheet` |
| `key` | Text | `Key` variable |

### 6. Confirm it saved

After the last **End If** (the outer one, at the bottom):

1. Add **Get Dictionary Value** → Get Value for `tag` in **If Result**. Pick the If Result from the **outer** If; it holds whichever branch's reply ran.
2. Add **If** → Dictionary Value **has any value**.
   - Inside: **Show Notification** → `Indexed` plus the Dictionary Value (for example "Indexed [LINK]").
   - **Otherwise:** **Get Dictionary Value** → `error` in that same If Result, then **Show Notification** → `Not saved:` plus that value.

Only successful saves return `tag`, so a broken connection never shows a false "Indexed".

### 7. Pin it

Open any share sheet (Photos is easiest). Scroll the app row to the end → **More** → **Edit**, and add **Index That** to Favorites so it sits near the front. That keeps every capture to two taps.

---

## Shortcut B: "Index Thought" (voice)

1. **Shortcuts** → **+** → name it **Index Thought**.
2. Add **Text** → paste your web app URL → **Set Variable** `Webhook`.
3. Add **Text** → paste your key → **Set Variable** `Key`.
4. Add **Dictate Text** → tap Show More → **Stop Listening: After Pause**.
5. Add **If** → `Dictated Text` **has any value**. If you say nothing, it stops quietly.
6. Inside the If: **Get Contents of URL** → URL: `Webhook`, Method **POST**, Request Body **JSON**:

| Key | Type | Value |
|---|---|---|
| `type` | Text | `text` |
| `text` | Text | Dictated Text |
| `source` | Text | `dictation` |
| `key` | Text | `Key` variable |

7. Still inside the If: **Get Dictionary Value** → `tag` from **Contents of URL**, then **If** → Dictionary Value **has any value**:
   - Inside: **Show Notification** → `Indexed`.
   - **Otherwise:** **Get Dictionary Value** → `error` from Contents of URL → **Show Notification** → `Not saved:` plus that value.

### Trigger it without opening anything

- **Back Tap:** Settings → Accessibility → Touch → **Back Tap** → **Double Tap** → scroll to Shortcuts → **Index Thought**. Double-tap the back of the phone to start talking. Source: [Apple, Back Tap](https://support.apple.com/guide/shortcuts/run-shortcuts-tapping-iphone-apd897693606/ios).
- **Action Button** (iPhone 15 Pro and later): Settings → **Action Button** → swipe to **Shortcut** → choose **Index Thought**. Check on your phone; the menu wording can vary by iOS version.
- **Siri:** say "Index Thought".

### Screenshots in one move

Take the screenshot, tap the thumbnail in the corner, tap **Share** → **Index That**. It's saved without leaving the app you were in.

---

## Test it

1. Run **Index Thought** and say "test one".
2. Open the Index That Inbox Doc. The newest entry should read `[NOTE] Voice · <today's date and time>` with "test one" under it.
3. Share any Instagram post with **Index That**. You should see `[LINK] Instagram · …` with the link.
4. Share a screenshot. You should see `[ASSET] Screenshot · …` and a link to the image file in the inbox Drive folder.

If something goes wrong:

- **"Not saved: Unauthorized"**: the key in the Shortcut doesn't match `INGEST_KEY`.
- **"Not saved: ... DOC_ID"**: the Doc ID was never pasted into `Code.gs`.
- **A web page or sign-in screen instead of a reply, or the PWA stuck on "Syncing"**: the deployment's "Who has access" isn't **Anyone**. Fix it under Deploy → Manage deployments.

## Limits

- **No offline queue.** Shortcuts need a connection. Offline, use the PWA, which saves captures and syncs them later.
- **Back Tap needs the phone unlocked.** Check this on your phone; Apple doesn't say it outright.
- **Instagram and X hide page titles from servers.** Those entries show the platform name and the link instead of the post's title. Add a note in the Share Sheet text if the context matters.
- **One image per share.** If you share several photos, only the first is sent.

## How AI readers use the inbox

Every entry has the same shape, so Claude Code, Gemini and other agents can scan it reliably:

```
[TAG] Platform · Day, Mon D, YYYY at H:MM AM/PM      ← Heading 3
Title (linked)                                       ← links only
https://the.url                                      ← links only
Note or dictated text                                ← if any
📎 Image: capture-YYYY-MM-DD_HHMMSS-xxxxxxxx.jpg      ← images only, linked to the Drive file
────────────────────────────────────────────────────
```

- `[NOTE]` is a thought or plain text, `[LINK]` is a link or text containing one, and `[ASSET]` is an image.
- Platform is `Instagram`, `X`, `TikTok`, `YouTube`, `LinkedIn`, `Threads`, `Reddit`, another site's domain, `Voice`, `Screenshot` or `Note`.
- **Claude** reads it through the Google Docs connector (the Doc) and the Google Drive connector (the image files).
- **Gemini** reads the Doc in Drive directly, or add it as a NotebookLM source.
- **Other agents** use the same Doc and folder through your own Google access.

The Doc and folder are private to your Google account. Don't share them with anyone.
