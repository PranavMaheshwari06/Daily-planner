# Daily planner: implementation plan (v2)

## Goal
One personal planner that works on phone and laptop: hourly day view, weekly repeats, automatic habit logging,
dark Apple-style look, live sync between devices. No server to run, no cost.

## Decisions (confirmed with the owner)
- Hosting (superseded by v4: GitHub Pages + Firebase, see `docs/PLAN-v4.md`): private Claude artifact. Data is stored per user in the artifact `db` capability, so it is private to the
  owner's claude.ai account. Must be opened in a browser signed in to claude.ai (not WhatsApp's in-app browser).
- Same code also builds to a standalone `dist/planner.html` (localStorage only) for offline use.
- Look: true black, graphite cards, iOS blue accent. Phone first, desktop gets a sidebar. Templates live in `design/`
  (source of the canvas boards) and on the Claude design canvas "Daily Planner - UI Design".
- Commits are authored by the owner. No AI co-author trailers.

## Architecture (unchanged, tested)
- `src/logic.js`: pure logic (dates, recurrence, auto-logging from the clock, habits, streaks, import validation). Unit tested.
- `src/ui.js`: rendering, events, storage adapter. Smoke tested with jsdom and a mocked `claude` runtime.
- `src/style.css`: design tokens and components.
- `build.js`: inlines css and js into `template.html` -> `dist/planner.html`.
- Data model: state `{habits, tagHabit, blocks, marks, hiddenTags}`; clock-derived status is never stored, only exceptions.

## Work items
1. Live sync
   - Subscribe with `onSnapshot` to `core` and the marks docs of the current and previous year; apply remote changes
     when there are no unsaved local changes, otherwise merge after our write lands.
   - Echo suppression: ignore snapshots equal to the last JSON we wrote.
   - Visible state in the top bar: Synced / Saving / Offline. Red banner when running without cloud
     (not signed in, or opened in an in-app browser) saying data stays on this device only.
2. Dark Apple-style UI (mobile first)
   - Tokens: bg #000, card #1C1C1E, elevated #2C2C2E, separator #38383A, text #FFF, secondary #AEAEB2, accent #0A84FF
     (filled buttons #0B6FE8 for 4.5:1 contrast), now-line #FF453A.
   - Phone (<= 760px): header with month + weekday title, week strip (tap month to expand full month), progress ring,
     floating + button, bottom tab bar (Day, Habits, Data), edit as bottom sheet with slide-up transition.
   - Desktop: top bar, left column (month, tags, habits), timeline card.
   - Round check circles, 12px tile radius, 18-20px card radius, blurred translucent bars, 200-300ms ease transitions,
     `prefers-reduced-motion` respected, safe-area insets, 44px touch targets.
3. Tests: keep the 21 logic tests and 16 smoke tests passing; add tests for sync (remote update applied, no echo loop,
   not-signed-in banner), phone layout elements (week strip, tab bar, sheet).
4. Release: build, publish to the Claude artifact (same slug, so the link does not change), declare capabilities
   `{db, user, downloads}` unchanged, export `dist/planner.html`.

## Later (not in this pass)
Seven-column week view; per-habit custom schedules; reminders via phone calendar.

## Working from a phone
Claude Code on the phone can edit `src/`, run `npm test`, and commit. Publishing the artifact needs the Claude chat
with the artifact tools, so ask Claude in chat: "publish the latest planner build".
