/* Runs sheets/export.gs in Node with stub Google services: Firestore decoding, weekly rows, re-runs replace rows. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const logic = fs.readFileSync(__dirname + '/../src/logic.js', 'utf8');

const enc = v => v === null ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : typeof v === 'object' ? { mapValue: { fields: encF(v) } } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
const encF = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
const docs = {
  core: { v: 1, years: ['2026'], tagHabit: {}, hiddenTags: [],
    habits: [{ id: 'h-gym', name: 'Gym', color: '#30D158' }],
    tags: [{ id: 'gym', name: 'Gym', color: '#30D158' }, { id: 'personal', name: 'Personal', color: '#8E8E93' }],
    blocks: [{ id: 'bg', title: 'Gym session', tag: 'gym', start: 480, end: 540, habit: 'h-gym', notes: '', rep: 'weekly', startDate: '2026-11-02', endDate: null, days: [0, 2, 4], ex: [] }] },
  'marks-2026': { m: { 'b|2026-11-11|bg': 'x' } }
};

const sheets = {}, files = [];
const range = (sh, r, c, n, w) => ({
  setValues(v) { v.forEach((row, i) => { sh.rows[r - 1 + i] = row.slice(); }); return this; },
  getValues() { return sh.rows.slice(r - 1, r - 1 + n).map(x => x.slice(0, w)); },
  clearContent() { sh.rows.length = r - 1; return this; },
  setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; }
});
const sheet = name => ({ rows: [], getRange(r, c, n, w) { return range(this, r, c, n || 1, w || 1); }, getLastRow() { return this.rows.length; },
  getMaxRows: () => 1000, setFrozenRows() {}, setConditionalFormatRules() {}, autoResizeColumns() {} });
const rule = new Proxy({}, { get: () => function () { return this; } });
const ctx = {
  globalThis: null, Date, JSON, Math, String, Number, Object,
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)), deleteSheet() {} }),
    newConditionalFormatRule: () => rule, InterpolationType: {} },
  ScriptApp: { getOAuthToken: () => 't', getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ onWeekDay: () => ({ atHour: () => ({ create() {} }) }) }) }), WeekDay: {} },
  UrlFetchApp: { fetch: url => {
    if (url.endsWith('logic.js')) return { getContentText: () => logic };
    const d = docs[url.split('/').pop()];
    return { getResponseCode: () => d ? 200 : 404, getContentText: () => JSON.stringify({ fields: encF(d) }) };
  } },
  DriveApp: { getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ createFile: (n, t) => files.push([n, t]) }) }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../sheets/export.gs', 'utf8'), ctx);

ctx.setup();
assert.deepStrictEqual(Object.keys(sheets).sort(), ['Blocks', 'Habits', 'Tags', 'Weeks']);
const L = ctx.loadLogic(), st = ctx.readState(L);
assert.strictEqual(st.blocks[0].start, 480);
assert.strictEqual(st.marks['b|2026-11-11|bg'], 'x');

ctx.exportWeeks(L, st, ['2026-11-09']);                      // both weeks are fully past, so statuses are final
ctx.exportWeeks(L, st, ['2026-11-09', '2026-11-02']);       // re-run plus an older week: no duplicates, sorted
const J = x => JSON.parse(JSON.stringify(x));   // rows come from the vm realm
const W = J(sheets.Weeks.rows.slice(1)), H = J(sheets.Habits.rows.slice(1)), B = J(sheets.Blocks.rows.slice(1)), T = J(sheets.Tags.rows.slice(1));
assert.deepStrictEqual(W.map(r => r[0]), ['2026-W45', '2026-W46']);
const w46 = W[1];
assert.deepStrictEqual(w46.slice(3, 7), [3, 2, 1, 2 / 3]);  // Mon, Wed (skipped), Fri
assert.deepStrictEqual([w46[7], w46[8], w46[9]], [3, 2, 1]);
assert.strictEqual(B.length, 6);
assert.deepStrictEqual(B.find(r => r[1] === '2026-11-11').slice(2), ['Wed', '08:00', '09:00', 60, 'Gym session', 'Gym', 'skipped']);
assert.deepStrictEqual(H.map(r => r[0] + ' ' + r[1] + ' ' + r[3]), ['2026-W45 Gym 3', '2026-W46 Gym 2']);
assert.deepStrictEqual(T.map(r => r.join(' ')), ['2026-W45 Gym 3 3', '2026-W46 Gym 3 2']);

ctx.backup(L, st, '2026-11-09');
assert.strictEqual(files[0][0], 'planner-2026-W46.json');
assert.strictEqual(JSON.parse(files[0][1]).state.blocks.length, 1);
console.log('sheets export: ok');
