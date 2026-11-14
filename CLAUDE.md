# Daily planner

Single-file planner app. Read `docs/PLAN.md` first.

- Edit `src/` only. `npm test` runs logic tests, builds, and runs the jsdom smoke test.
- `dist/planner.html` is generated; never edit it.
- Keep logic pure in `src/logic.js` (no DOM). UI and storage live in `src/ui.js`.
- Git: commit as the repo owner. Do not add Co-Authored-By or "Generated with" lines.
- Style: no emoji, few colors, tags colors in `logic.js` TAGS, tokens in `style.css`.

## Hosting and publishing
- Live app: private Claude artifact "Planner", slug 9a6821d2-5b96-4d1d-baa4-8dba1d6f2309
  (https://claude.ai/artifact/L4sjby1Wo8zEmAsXUjDRu2). Data lives in its `db` capability, per user.
- Design boards: Claude design canvas "Daily Planner - UI Design", slug 12a3fece-14be-4558-ab20-86937e38eebd.
- Publishing needs a Claude chat with the artifact tools: build with `npm run build`, then publish `dist/planner.html`
  as index.html of the artifact above (same slug keeps the link). Capabilities stay `{db:{}, user:{}, downloads:{}}`.
