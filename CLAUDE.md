# Daily planner

Single-file planner app. Read `docs/PLAN.md` first.

- Edit `src/` only. `npm test` runs logic tests, builds, and runs the jsdom smoke test.
- `dist/planner.html` is generated; never edit it.
- Keep logic pure in `src/logic.js` (no DOM). UI and storage live in `src/ui.js`.
- Git: commit as the repo owner. Do not add Co-Authored-By or "Generated with" lines.
- Style: no emoji, few colors, tags colors in `logic.js` TAGS, tokens in `style.css`.
