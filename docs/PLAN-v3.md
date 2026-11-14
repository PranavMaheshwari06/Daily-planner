# Planner v3 plan (next batch)

Status: items 1 to 4 built and tested; item 5 built in part (see below). Starter week template is not built. Read `docs/PLAN.md` and `CLAUDE.md` first. Build, test (`npm test`), commit as the owner, then publish.

## 1. Habit cards: dates and weekly counters (phone Habits tab)
- Under each weekday letter show the date number, very small (10px, grey; today in blue). Order per column: letter, date, circle.
- Each habit card shows a live weekly counter: `done of planned this week` (planned = days with a linked block or a manual mark,
  including days still to come). Updates the moment a block ends or a circle is flipped.
- The weekly counters roll up into the monthly view (item 2) and into a "Week" column on the desktop habit grid.
- Logic: add `weekStats(state, habitId, weekStartDate, now)` to `src/logic.js` returning `{done, missed, planned, upcoming}`; unit test it.

## 2. Monthly progress, in numbers
- Place: top of the Habits tab, above the habit cards, one compact card "November".
  - Big number: month completion `done / (done + missed)` as a percent, with `22 of 30 planned habit-days` beneath.
  - Week rows: `W45 5/6`, `W46 4/5` ... one line per week with a thin bar.
  - Per-habit chips: `Gym 9/10`, `Study 10/10` ... tapping one scrolls to its card.
  - Best current streak and longest streak this month.
- Desktop: same card above the habit grid, plus the Week column.
- Day view: only the small progress ring that exists today. No monthly numbers there.
- Logic: add `monthSummary(state, y, m, now)` to `src/logic.js`; unit test it.

## 3. Colours the user picks
- Tags become editable data in state (`tags[]`: id, name, color). Existing ids (work, study, gym, german, jobs, personal) are migrated.
- Colour picker: large swatch palette plus free hex input. Tile fill, text and check colours are derived from the one chosen colour.
- Habits use the same picker. Add, rename, delete tags in a "Tags" sheet.

## 4. Full 24-hour day
- Grid 00:00 to 24:00, opens scrolled near the current time (or 06:00 on other days). Blocks cannot cross midnight.
- `DAY_START = 0`, `DAY_END = 1440`; update validation, the time selects, tests and design boards.

## 5. Candidates (confirmed with the owner)
Built and tested:
- Drag to move and resize tiles. Times snap to 15 minutes; a repeating block changes on that day only; Undo in the toast. On touch, resize handles work at once and a tile moves after a short press. The edit dialog is the keyboard route.
- Copy a block to another day. "Copy to another day" in the editor of a saved block: date field, Next day and Next week shortcuts. Makes a one-off copy; done and skipped marks are not copied.
- Seven-column week view. Week segment on desktop, Week tab on phone. Tap a block to edit, an hour to add, a day header to open that day. Tiles can be dragged up and down within a day; to change the day use Copy or the date in the editor.

Not built (not chosen): starter week template.

## Where to work
New chat with this repo attached (edit, test, push and publish in one place), or Claude Code on the phone for edits only.
Publish target: see `CLAUDE.md`.
