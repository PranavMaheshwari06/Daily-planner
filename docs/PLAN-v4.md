# Planner v4: own hosting, Firebase sync, weekly Sheets export

Status: Phase 1 code and `sheets/export.gs` written and tested. Waiting on Phase 0: the Firebase config goes into
`src/cloud.js` (`FIREBASE_CONFIG`), the owner uid into `firestore.rules` and `sheets/export.gs`.

## Context
The planner is a private Claude artifact today. The data sits in the artifact's `db`, which has three problems:
- It opens only in a browser signed in to claude.ai, so it breaks in in-app browsers.
- Every release has to be published from a Claude chat.
- There is no backup.

The goal is one URL that opens on any device and shows the same data and the same look. Edits sync live, so a block changed on the phone appears on the laptop. Pushing to `main` deploys. Every week the data is exported to Google Sheets for insights and backup. It all stays free and private.

Decisions (confirmed): **Firebase** (Firestore + Google sign-in, free Spark plan) and **GitHub Pages** from this repo, made public. The repo holds only code; the data lives in Firestore and is locked to your account.

Why Firebase is a small change: `Store` in [src/ui.js:35-205](src/ui.js#L35-L205) already uses the Firestore call shape: `db.doc(path).get()` / `.set()` / `.onSnapshot()`, with `snap.exists` and `snap.data()`. The live sync, echo suppression, per-year marks docs and retry logic all stay as they are. Only the source of `db` and the user id changes.

## Answers to your questions
- **Do we still publish from a Claude chat?** No. A push to `main` runs `npm test`, and if it passes a GitHub Action deploys to Pages. The Claude artifact is retired after migration.
- **Will the database overflow?** No. The free tier has 1 GiB and your data is tens of KB a year, with marks already split per year. The weekly export is for insights and backup. Nothing is deleted from Firestore, because deleting history would break streaks and monthly stats.
- **When should you send the UI changes?** Right after Phase 2, when sync is live and your data is migrated. They go into the design boards first (`design/` plus the canvas). You approve them, then we build. Phases 1 and 2 add only a sign-in card in the current style.

## Phase 0: steps only you can do (about 10 minutes, browser)
1. Before going public I scan the repo (fixtures, `design/`, git history) for anything personal and report back. Then you set the repo to Public and set Settings → Pages → Source to "GitHub Actions".
2. Firebase setup at console.firebase.google.com:
   1. Create a project (no Analytics) and add a Web app. Send me the `firebaseConfig` object. It is not a secret.
   2. Authentication: enable Google, and add `pranavmaheshwari06.github.io` to Authorized domains.
   3. Firestore: create a database in production mode, in a region near you.
3. After your first sign-in I give you the rules with your uid filled in, and you paste them into Firestore → Rules.

## Phase 1: code (this repo)
- **New `src/cloud.js`** (about 50 lines). It sets up Firebase from a `FIREBASE_CONFIG` constant and turns on the offline cache (`enablePersistence({synchronizeTabs:true})`). It exposes `window.plannerCloud = { use('db') -> firestore, use('user') -> {id()}, signIn(), signOut() }`.
  - `signIn` uses `signInWithPopup`, because the redirect flow is broken on iOS Safari for domains other than firebaseapp.com.
  - If the `firebase` global is missing (offline first load, or jsdom tests), it does nothing.
- **`src/ui.js` Store:** the seam is `var rt = window.plannerCloud || window.claude` in `init` and `cloudInit`. Everything else stays.
  - `download()` is unchanged. Without `window.claude` it already falls back to a Blob download.
  - Banner text: remove the claude.ai wording.
- **Sign-in gate:** if `plannerCloud` exists and you are signed out, render only a "Sign in with Google" card. There is no local-only editing before sign-in, so nothing can be overwritten later. Add Sign out in the Data sheet.
- **`template.html`:** add the pinned Firebase compat scripts from gstatic (app, auth, firestore) and a `/*CLOUD*/` slot.
- **`build.js`:** substitute CLOUD and write `dist/index.html`. Also copy `src/logic.js` to `dist/logic.js`, which the Sheets script loads.
- **New `firestore.rules`:** `match /data/users/{uid}/{doc}`. Read and write only if `request.auth.uid == uid && uid == "<your uid>"`, so nobody else can even create data. The existing paths `data/users/<id>/core` and `marks-<year>` are valid Firestore doc paths.
- **New `.github/workflows/pages.yml`:** on push to `main`, run `npm ci`, `npm test`, `upload-pages-artifact dist/`, `deploy-pages`.
- **Tests:** jsdom does not load external scripts, so the existing 44 tests keep using the `window.claude` mock without changes. I'll add 2 smoke tests:
  - a `window.plannerCloud` mock is used ahead of `window.claude`;
  - when signed out, the sign-in card renders and no planner board appears.
- **Docs:**
  - `CLAUDE.md`: replace the hosting and publishing section. The new flow is push to main → Pages, and the Firebase project is named.
  - `docs/PLAN.md`: hosting decision becomes superseded.
  - New `docs/PLAN-v4.md`: this plan.
- Commits are authored by the owner, with no co-author lines.

## Phase 2: migrate and verify (you, guided)
1. Old artifact → Data → Export JSON.
2. New site → sign in → Data → Import → Replace.
3. Open the site on the iPhone (Safari) and on the laptop. Edit a block on one and watch it change on the other.
4. Keep the old artifact untouched for a week as a fallback, then delete it.

## Phase 3: weekly insights to Google Sheets
**Apps Script inside your own Google Sheet:** no keys stored anywhere, and the data never leaves your Google account. The source is kept in `sheets/export.gs` and `sheets/appsscript.json`.
- It reads Firestore over REST as you: `ScriptApp.getOAuthToken()` with the `datastore` scope and the `X-Goog-User-Project: <firebase project>` header. A small decoder turns Firestore values into JSON.
- It loads `https://pranavmaheshwari06.github.io/Daily-planner/logic.js` and evaluates it. Stats therefore use the same tested `weekStats`, `occurrencesOn` and `occStatus` code as the app, with nothing copied over.
- `setup()` (run once) builds the template:

  | Tab | One row per | Columns |
  |---|---|---|
  | Weeks | ISO week | Week, Start, End, Habit-days planned, Done, Missed, Completion %, Hours planned, Hours done, Blocks skipped, Best streak, Exported at |
  | Habits | week × habit | Week, Habit, Planned, Done, Missed, Completion %, Current streak |
  | Tags | week × tag | Week, Tag, Hours planned, Hours done |
  | Blocks | occurrence | Date, Day, Start, End, Minutes, Title, Tag, Status |

  It also sets frozen headers, % and number formats and conditional colour on Completion %.
- `weekly()` exports the week that just ended. It is re-runnable: that week's rows are replaced, not duplicated. It also saves the full JSON backup as `planner-YYYY-Www.json` in a Drive folder named "Planner backups".
- **Trigger:** Monday between 00:00 and 01:00. That is the end of Sunday night, and it means late Sunday blocks have already finished, so their status is final.
- **You:** create a blank Sheet, open Extensions → Apps Script, paste the two files, run `setup` and approve once. I walk you through it.

## Later (after the above, separate plans)
1. UI changes: design boards → your approval → build.
2. Reminders 15 minutes before the next block on the iPhone and the Windows laptop. To plan once the above works. The likely direction is a private calendar feed (.ics) that the phone and laptop calendars subscribe to, so they fire alerts natively without a push server.

Skipped: offline first load (a service worker). Once a device has opened the app, Firestore's cache covers flaky connections. Add it if you need the app to open with no network at all.

## Verification
- `npm test`: the 44 existing tests plus 2 new ones pass, and the build writes `dist/index.html` and `dist/logic.js`.
- The Action on push is green and the Pages URL loads.
- Sign-in works in desktop Chrome and in iPhone Safari. Add-to-Home-Screen mode has a known popup risk, so it gets tested explicitly; the fallback is a Safari bookmark.
- Rules check: a Firestore read from a second Google account is denied.
- Two-device live sync: an edit on the phone shows on the laptop within about 1 s, and the reverse.
- Airplane mode on a device that has opened the app before: edits queue, then sync on reconnect.
- Sheets: run `weekly()` by hand, check rows in all four tabs and the Drive backup, run it again with no duplicates, and confirm the trigger is listed.
