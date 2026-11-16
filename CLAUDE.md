# Daily planner

Single-file planner app. Read `docs/PLAN.md`, then `docs/PLAN-v4.md` (current).

- Edit `src/` only. `npm test` runs logic tests, builds, runs the jsdom smoke test and the Sheets export test.
- `dist/` is generated; never edit it.
- Keep logic pure in `src/logic.js` (no DOM). UI and storage live in `src/ui.js`; the Firebase adapter in `src/cloud.js`.
- Git: commit as the repo owner. Do not add Co-Authored-By or "Generated with" lines.
- Style: no emoji, few colors, tags colors in `logic.js` TAGS, tokens in `style.css`.

## Hosting and publishing
- Live app: GitHub Pages, https://pranavmaheshwari06.github.io/Daily-planner/. A push to `main` runs `npm test` and
  deploys `dist/` (`.github/workflows/pages.yml`). No Claude chat needed.
- Data: Firebase project (config in `src/cloud.js`), Firestore docs `data/users/<uid>/core` and `marks-<year>`,
  Google sign-in. Access rules: `firestore.rules` (owner uid only), pasted in the Firebase console.
- Weekly export: `sheets/export.gs` runs in the owner's Google Sheet (Apps Script), Monday 00:00-01:00.
  It loads `logic.js` from the site, so logic changes need no re-paste; changes to `export.gs` itself do.
- Old host (retire after migration): Claude artifact "Planner", slug 9a6821d2-5b96-4d1d-baa4-8dba1d6f2309.
- Design boards: `design/` and the Claude design canvas "Daily Planner - UI Design", slug 12a3fece-14be-4558-ab20-86937e38eebd.
