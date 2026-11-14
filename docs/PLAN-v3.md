# Planner v3 plan (next batch)

Status: items 1 to 4 built and tested; item 5 is still a list of candidates (confirm before building). Read `docs/PLAN.md` and `CLAUDE.md` first. Build, test (`npm test`), commit as the owner, then publish.

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

## 5. Candidates (confirm before building)
Drag to move/resize tiles, copy block to another day, starter week template, seven-column week view.

## Where to work
New chat with this repo attached (edit, test, push and publish in one place), or Claude Code on the phone for edits only.
Publish target: see `CLAUDE.md`.
