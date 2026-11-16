const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../dist/planner.html', 'utf8');
const FIXED = new Date(2026, 10, 13, 14, 20).getTime();
let pass = 0; const errors = [];
const t = async (n, f) => { try { await f(); pass++; console.log('ok  ', n); } catch (e) { console.log('FAIL', n, '\n    ', e.stack.split('\n').slice(0,3).join('\n     ')); process.exitCode = 1; } };
const wait = ms => new Promise(r => setTimeout(r, ms));

const SUBS = new WeakMap();
function mkDb(store) {
  const subs = SUBS.get(store) || SUBS.set(store, {}).get(store);
  const clone = o => o && JSON.parse(JSON.stringify(o));
  return { doc: p => ({
    get: async () => ({ exists: p in store, data: () => clone(store[p]) }),
    set: async o => { store[p] = clone(o); (subs[p] || []).slice().forEach(f => setTimeout(() => f({ exists: true, data: () => clone(store[p]) }), 0)); },
    onSnapshot: cb => { (subs[p] = subs[p] || []).push(cb); setTimeout(() => cb({ exists: p in store, data: () => clone(store[p]) }), 0); return () => { subs[p] = subs[p].filter(f => f !== cb); }; }
  }) };
}
function boot(opts) {
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message)); vc.on('error', m => errors.push(String(m)));
  return new JSDOM(html, { runScripts: 'dangerously', url: opts.url || 'https://x.test/', virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      const RD = w.Date;
      class FD extends RD { constructor(...a) { if (a.length === 0) super(FIXED + (w.__off || 0)); else super(...a); } static now() { return FIXED + (w.__off || 0); } }
      w.Date = FD;
      w.scrollTo = (x, y) => { (w.__scrolls = w.__scrolls || []).push(y); };
      if (opts.width) Object.defineProperty(w, 'innerWidth', { value: opts.width, configurable: true });
      if (opts.claude) w.claude = opts.claude;
      if (opts.cloud) w.plannerCloud = opts.cloud;
    } });
}
const $ = (w, s) => w.document.querySelector(s), $$ = (w, s) => [...w.document.querySelectorAll(s)];
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
function typeIn(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); }
function setSel(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); }

/* Saved planner for Nov 2026 (clock is Fri 13 Nov 14:20): Gym and Study every weekday, German on Fridays from 6 Nov, Gym skipped on Wed 11. */
function fixtureStore(uid) {
  const wk = [0, 1, 2, 3, 4], st = {};
  st['data/users/' + uid + '/core'] = { v: 1, years: ['2026'], tagHabit: {}, hiddenTags: [],
    habits: [{ id: 'h-gym', name: 'Gym', color: '#30D158' }, { id: 'h-study', name: 'Study', color: '#BF5AF2' }, { id: 'h-german', name: 'German', color: '#FF9F0A' }],
    blocks: [
      { id: 'bg', title: 'Gym session', tag: 'gym', start: 480, end: 540, habit: 'h-gym', notes: '', rep: 'weekly', startDate: '2026-11-02', endDate: null, days: wk, ex: [] },
      { id: 'bs', title: 'Study', tag: 'study', start: 540, end: 720, habit: 'h-study', notes: '', rep: 'weekly', startDate: '2026-11-02', endDate: null, days: wk, ex: [] },
      { id: 'bd', title: 'German B1 practice', tag: 'german', start: 900, end: 960, habit: 'h-german', notes: '', rep: 'weekly', startDate: '2026-11-06', endDate: null, days: [4], ex: [] }] };
  st['data/users/' + uid + '/marks-2026'] = { m: { 'b|2026-11-11|bg': 'x' } };
  return st;
}
const cloudFor = (store, uid) => ({ use: async n => n === 'db' ? mkDb(store) : n === 'user' ? { id: async () => uid } : { save: async () => {} } });

(async () => {
  const store = {}; const saves = [];
  const claude = { use: async n => n === 'db' ? mkDb(store) : n === 'user' ? { id: async () => 'u1' } : { save: async o => { saves.push(o); } } };
  let dom = boot({ claude }); let w = dom.window;
  await wait(100);

  await t('boots into day view with no errors', () => {
    assert.strictEqual(errors.length, 0, errors.join('|'));
    assert.ok($(w, '.grid')); assert.match($(w, '.ttl').textContent, /Friday, 13 November 2026/);
    assert.match($(w, '.dayh').textContent, /Week 46/);
    assert.strictEqual($$(w, '.hr').length, 24);
    assert.ok($(w, '.nowl b').textContent === '14:20');
  });

  await t('24-hour grid: 00:00 to 23:00 rows, 1248px tall, opens near the current time', () => {
    const labels = $$(w, '.hrl').map(e => e.textContent);
    assert.strictEqual($$(w, '.hr')[0].dataset.m, '0'); assert.strictEqual($$(w, '.hr')[23].dataset.m, '1380');
    assert.strictEqual(labels[0], '00:00'); assert.strictEqual(labels[6], '06:00');
    assert.strictEqual($(w, '.grid').style.height, '1248px');
    assert.ok(Math.abs(w.__scrolls[0] - (860 * 52 / 60 - 90)) < 1, 'scrolled to ' + w.__scrolls[0]);   // 14:20 minus some context
    click(w, $(w, '.hr[data-m="1380"]'));
    const st = $(w, '.quick select[data-f="q-start"]').options, en = $(w, '.quick select[data-f="q-end"]').options;
    assert.strictEqual(st[0].textContent, '00:00'); assert.strictEqual(st[st.length - 1].textContent, '23:45');
    assert.strictEqual(en[0].textContent, '00:15'); assert.strictEqual(en[en.length - 1].textContent, '24:00');
    assert.strictEqual($(w, '.quick select[data-f="q-end"]').value, '1440');   // 23:00 + 1h stops at midnight
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!$(w, '.quick'));
  });

  await t('early block at 00:00 can be added and shows 00:00 – 01:00', () => {
    click(w, $(w, '.hr[data-m="0"]')); typeIn(w, $(w, '.qin'), 'Night owl');
    $(w, '.qin').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const tile = $$(w, '.tile').find(e => /Night owl/.test(e.textContent));
    assert.ok(tile); assert.match(tile.textContent, /00:00 – 01:00/);
    assert.strictEqual(tile.style.top, '2px');
    click(w, tile.querySelector('.tbody')); click(w, $(w, '[data-a="d-del"]')); click(w, $(w, '[data-a="d-del-one"]'));
    assert.ok(!$$(w, '.tile').some(e => /Night owl/.test(e.textContent)));
  });

  await t('other days open at 06:00', () => {
    click(w, $$(w, '.cd').find(b => b.dataset.d === '2026-11-17'));
    assert.match($(w, '.ttl').textContent, /Tuesday, 17 November/);
    assert.ok(Math.abs(w.__scrolls[w.__scrolls.length - 1] - (360 * 52 / 60 - 8)) < 1, 'scrolled to ' + w.__scrolls[w.__scrolls.length - 1]);
    click(w, $(w, '[data-a="today"]'));
    assert.ok(Math.abs(w.__scrolls[w.__scrolls.length - 1] - (860 * 52 / 60 - 90)) < 1);
  });

  await t('quick add via hour slot + Enter', async () => {
    click(w, $(w, '.hr[data-m="540"]'));
    const q = $(w, '.qin'); assert.ok(q);
    typeIn(w, q, 'Study: lecture notes');
    click(w, $(w, '.quick .chip[data-t="study"]'));
    assert.strictEqual($(w, '.qin').value, 'Study: lecture notes');   // preserved across re-render
    $(w, '.qin').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.strictEqual($$(w, '.tile').length, 1);
    assert.match($(w, '.tile').textContent, /09:00 – 10:00/);
    assert.match($(w, '.tile .pill').textContent, /Logged to Study/);   // 10:00 < 14:20 so already logged
    assert.match($(w, '.prog').textContent, /1 of 1 blocks done/);
  });

  await t('edit dialog: make it repeat weekdays, add a gym block', async () => {
    click(w, $(w, '.tile .tbody'));
    assert.ok($(w, '.dlg')); assert.strictEqual($(w, '#f-title').value, 'Study: lecture notes');
    click(w, $(w, '[data-a="d-rep"][data-r="weekdays"]'));
    click(w, $(w, '[data-a="d-save"]'));
    assert.ok(!$(w, '.dlg'));
    // new gym block through New block
    click(w, $(w, '[data-a="new"]'));
    typeIn(w, $(w, '#f-title'), 'Gym session');
    click(w, $(w, '.dlg .chip[data-t="gym"]'));
    assert.match($(w, '.hbar').textContent, /Count toward Gym/);
    setSel(w, $(w, '#f-start'), '1020'); setSel(w, $(w, '#f-end'), '1080');
    click(w, $(w, '[data-a="d-rep"][data-r="weekdays"]'));
    click(w, $(w, '[data-a="d-save"]'));
    assert.strictEqual($$(w, '.tile').length, 2);
    assert.match($$(w, '.tile')[1].textContent, /Auto-logs to Gym/);
    assert.strictEqual(errors.length, 0, errors.join('|'));
  });

  await t('next day shows weekday series? Fri->Sat none, Mon has both', async () => {
    click(w, $(w, '[data-a="next"]'));
    assert.strictEqual($$(w, '.tile').length, 0);
    click(w, $(w, '[data-a="next"]')); click(w, $(w, '[data-a="next"]'));
    assert.match($(w, '.ttl').textContent, /Monday, 16 November/);
    assert.strictEqual($$(w, '.tile').length, 2);
    assert.match($(w, '.tile .pill').textContent, /Auto-logs to Study/);
  });

  await t('click skip on today gym after it ends -> tracker shows missed', async () => {
    click(w, $(w, '[data-a="today"]'));
    w.__off = 5 * 3600e3;   // 19:20, gym 17-18 has ended
    click(w, $(w, '.tile:nth-of-type(2) .chk'));
    assert.match($$(w, '.tile')[1].className, /skip/);
    assert.match($$(w, '.tile')[1].textContent, /Not logged/);
    click(w, $(w, '[data-a="view"][data-v="habits"]'));
    const gymRow = $$(w, '.hrow.b')[0];
    assert.ok(gymRow.querySelector('.hc.missed'));
    const studyRow = $$(w, '.hrow.b')[1]; assert.ok(studyRow.querySelector('.hc.done'));
    assert.match($$(w, '.sc')[0].textContent, /0\s*in a row/);
    assert.match($$(w, '.sc')[1].textContent, /1\s*in a row/);
    assert.strictEqual($$(w, '.hrow.hd .hdc').length, 30);
    // flip tracker box back to done
    click(w, gymRow.querySelector('.hc.missed'));
    assert.ok($$(w, '.hrow.b')[0].querySelector('.hc.done'));
    click(w, $(w, '[data-a="view"][data-v="day"]'));
    assert.ok(!/skip/.test($$(w, '.tile')[1].className));
  });

  await t('habits dialog add / rename / remove', async () => {
    click(w, $(w, '[data-a="view"][data-v="habits"]'));
    click(w, $(w, '[data-a="hm-open"]'));
    const n0 = $$(w, '.hli').length; click(w, $(w, '[data-a="hm-add"]'));
    assert.strictEqual($$(w, '.hli').length, n0 + 1);
    const last = $$(w, '.hli input').pop(); typeIn(w, last, 'Read 20 pages');
    click(w, $(w, '[data-a="hm-close"]'));
    assert.ok($$(w, '.sc').some(c => /Read 20 pages/.test(c.textContent)));
    click(w, $(w, '[data-a="view"][data-v="day"]'));
  });

  await t('cloud persistence wrote docs and survives reload', async () => {
    await wait(900);
    assert.ok(store['data/users/u1/core'], Object.keys(store).join());
    assert.ok(store['data/users/u1/marks-2026']);
    assert.strictEqual(store['data/users/u1/core'].blocks.length, 2);
    const dom2 = boot({ claude }); await wait(100);
    const w2 = dom2.window;
    assert.strictEqual(errors.length, 0, errors.join('|'));
    assert.strictEqual($$(w2, '.tile').length, 2);
    assert.ok($$(w2, '.hside').length === 6);
    dom2.window.close();
  });

  await t('delete series: this and following', async () => {
    w.__off = 0;
    click(w, $(w, '[data-a="next"]')); click(w, $(w, '[data-a="next"]')); click(w, $(w, '[data-a="next"]'));
    click(w, $$(w, '.tile .tbody')[1]);
    click(w, $(w, '[data-a="d-del"]'));
    assert.ok($(w, '[data-a="d-del-follow"]'));
    click(w, $(w, '[data-a="d-del-follow"]'));
    assert.strictEqual($$(w, '.tile').length, 1);
    click(w, $(w, '[data-a="today"]'));
    assert.strictEqual($$(w, '.tile').length, 2);    // history kept
  });

  await t('tag filter hides tiles', async () => {
    click(w, $$(w, '.trow')[1]);  // study
    assert.strictEqual($$(w, '.tile').length, 1);
    click(w, $$(w, '.trow')[1]);
    assert.strictEqual($$(w, '.tile').length, 2);
  });

  await t('mini calendar: dots, week band, pick', async () => {
    assert.ok($$(w, '.cd.has').length >= 5);
    assert.strictEqual($$(w, '.cd.band').length, 7);
    click(w, $(w, '[data-a="cal-next"]'));
    assert.match($(w, '.calh .h3').textContent, /December 2026/);
    click(w, $$(w, '.cd')[10]);
    assert.ok($(w, '.cd.sel'));
  });

  await t('validation error shown in dialog', async () => {
    click(w, $(w, '[data-a="new"]'));
    click(w, $(w, '[data-a="d-save"]'));
    assert.match($(w, '.err').textContent, /title/i);
    $(w, '.dlg').ownerDocument.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!$(w, '.dlg'));
  });

  await t('export uses downloads capability; import + reset flow', async () => {
    click(w, $(w, '[data-a="data-open"]'));
    click(w, $(w, '[data-a="export"]')); await wait(20);
    assert.strictEqual(saves.length, 1);
    assert.match(saves[0].filename, /^planner-2026-11-13\.json$/);
    const parsed = JSON.parse(saves[0].data); assert.strictEqual(parsed.state.blocks.length, 2);
    // import through file input
    const inp = $(w, '#imp');
    const file = new w.File([saves[0].data], 'b.json', { type: 'application/json' });
    Object.defineProperty(inp, 'files', { value: [file] });
    inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(50);
    assert.ok($(w, '[data-a="import-ok"]'));
    click(w, $(w, '[data-a="import-ok"]'));
    click(w, $(w, '[data-a="reset"]')); click(w, $(w, '[data-a="reset-ok"]'));
    click(w, $(w, '[data-a="data-close"]'));
    assert.strictEqual($$(w, '.tile').length, 0);
    await wait(900);
    assert.strictEqual(store['data/users/u1/core'].blocks.length, 0);
    assert.ok(Object.keys(store['data/users/u1/marks-2026'].m).length === 0);
  });

  await t('bad import file is rejected', async () => {
    click(w, $(w, '[data-a="data-open"]'));
    const inp = $(w, '#imp'); Object.defineProperty(inp, 'files', { value: [new w.File(['{"hello":1}'], 'x.json')] });
    inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(50);
    assert.match($(w, '.dlg').textContent, /not a planner backup/);
    click(w, $(w, '[data-a="data-close"]'));
  });

  await t('local mode (no claude) persists in localStorage', async () => {
    const d = boot({}); await wait(80); const w3 = d.window;
    assert.match($(w3, '#sync').textContent, /device/);
    click(w3, $(w3, '.hr[data-m="600"]')); typeIn(w3, $(w3, '.qin'), 'Local'); click(w3, $(w3, '[data-a="q-add"]'));
    await wait(700);
    assert.ok(w3.localStorage.getItem('planner.v1').includes('Local'));
    const saved = w3.localStorage.getItem('planner.v1');
    const d2 = boot({}); d2.window.localStorage.setItem('planner.v1', saved); // other origin store; reload simulated by re-injecting
    d2.window.close(); d.window.close();
  });

  await t('cloud failure falls back to local with notice', async () => {
    const bad = { use: async () => { throw new Error('nope'); } };
    const d = boot({ claude: bad }); await wait(100);
    assert.ok($(d.window, '.grid')); assert.match($(d.window, '#sync').textContent, /device/);
    click(d.window, $(d.window, '[data-a="data-open"]'));
    assert.match($(d.window, '.dlg').textContent, /Cloud sync is unavailable/);
    d.window.close();
  });

  await t('signed-out user (id null) falls back', async () => {
    const so = { use: async n => n === 'user' ? { id: async () => null } : mkDb({}) };
    const d = boot({ claude: so }); await wait(100);
    assert.ok($(d.window, '.grid')); d.window.close();
  });


  await t('live sync: edit on device A appears on device B', async () => {
    const shared = {}; const cl = { use: async n => n === 'db' ? mkDb(shared) : n === 'user' ? { id: async () => 'u9' } : { save: async () => {} } };
    const A = boot({ claude: cl }); const B = boot({ claude: cl }); await wait(150);
    assert.strictEqual($$(B.window, '.tile').length, 0);
    click(A.window, $(A.window, '.hr[data-m="600"]')); typeIn(A.window, $(A.window, '.qin'), 'From phone'); click(A.window, $(A.window, '[data-a="q-add"]'));
    await wait(1600);
    assert.ok(shared['data/users/u9/core'].blocks.length === 1);
    assert.strictEqual($$(B.window, '.tile').length, 1);
    assert.match($(B.window, '.tile').textContent, /From phone/);
    // and back: B edits (skip tile after it ended), A sees it, no echo loop
    click(B.window, $(B.window, '.tile .chk')); await wait(1600);
    assert.strictEqual($$(A.window, '.tile.skip').length, 1);
    A.window.close(); B.window.close();
  });

  await t('remote change waits while a dialog is open', async () => {
    const shared = {}; const cl = { use: async n => n === 'db' ? mkDb(shared) : n === 'user' ? { id: async () => 'u8' } : { save: async () => {} } };
    const A = boot({ claude: cl }); const B = boot({ claude: cl }); await wait(150);
    click(B.window, $(B.window, '[data-a="new"]'));
    typeIn(B.window, $(B.window, '#f-title'), 'Typing in B');
    click(A.window, $(A.window, '.hr[data-m="660"]')); typeIn(A.window, $(A.window, '.qin'), 'Meanwhile in A'); click(A.window, $(A.window, '[data-a="q-add"]'));
    await wait(1600);
    assert.strictEqual($(B.window, '#f-title').value, 'Typing in B');   // not clobbered
    click(B.window, $(B.window, '[data-a="d-cancel"]'));
    await wait(50);
    assert.strictEqual($$(B.window, '.tile').length, 1);                 // applied after closing
    A.window.close(); B.window.close();
  });

  await t('red banner when cloud was expected but unavailable; none for standalone', async () => {
    const bad = { use: async () => { throw new Error('nope'); } };
    const d = boot({ claude: bad }); await wait(100);
    assert.match($(d.window, '.banner').textContent, /Not syncing/);
    const s = boot({}); await wait(80);
    assert.ok(!$(s.window, '.banner')); d.window.close(); s.window.close();
  });

  await t('phone layout: week strip, tab bar, fab, month toggle, sheet', async () => {
    const d = boot({ width: 390 }); await wait(100); const p = d.window;
    assert.ok($(p, '.wkstrip')); assert.strictEqual($$(p, '.wkd').length, 7); assert.ok($(p, '.tabbar')); assert.ok($(p, '.fab'));
    assert.ok(!$(p, '.side'));
    click(p, $$(p, '.wkd')[0]); assert.match($(p, '.ph-title .d1').textContent, /Monday/);
    click(p, $(p, '[data-a="cal-toggle"]')); assert.ok($(p, '.phcal')); assert.ok(!$(p, '.wkstrip'));
    click(p, $$(p, '.phcal .cd')[20]); assert.ok($(p, '.wkstrip'));
    click(p, $(p, '[data-a="new"]')); assert.ok($(p, '.dlg .grab')); assert.ok($(p, '#f-title'));
    click(p, $(p, '[data-a="d-cancel"]'));
    click(p, $(p, '.tabbar [data-v="habits"]')); assert.strictEqual($$(p, '.hcard').length, 5);
    assert.strictEqual($$(p, '.hcard')[0].querySelectorAll('.wk button').length, 7);
    click(p, $(p, '.tabbar [data-a="data-open"]')); assert.ok($(p, '.dlg'));
    d.window.close();
  });

  const rgbOf = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
  const isColor = (css, hex) => css.toLowerCase() === hex.toLowerCase() || css === rgbOf(hex);

  await t('tags sheet: add, rename, pick a colour from the palette or type hex', async () => {
    const d = boot({}); await wait(80); const p = d.window, P = p.PlannerLogic;
    click(p, $(p, '[data-a="tg-open"]'));
    assert.ok($(p, '.dlg')); assert.match($(p, '.dlg h2').textContent, /Tags/);
    assert.strictEqual($$(p, '.dlg .hli').length, 6);
    click(p, $(p, '[data-a="tg-add"]'));
    assert.strictEqual($$(p, '.dlg .hli').length, 7);
    typeIn(p, $$(p, '.dlg .hli')[6].querySelector('input'), 'Reading');
    assert.strictEqual(p.__planner.S.tags[6].name, 'Reading');
    click(p, $$(p, '.dlg .hli')[6].querySelector('.cswatch'));
    assert.strictEqual($$(p, '.sw3').length, P.PALETTE.length);
    click(p, $$(p, '.sw3')[4]);
    assert.strictEqual(p.__planner.S.tags[6].color, P.PALETTE[4]);
    assert.strictEqual($$(p, '.sw3')[4].getAttribute('aria-pressed'), 'true');
    const hex = $(p, '.hex'); assert.strictEqual(hex.value, P.PALETTE[4]);
    typeIn(p, hex, '12ab34');                                     // free hex, no #
    assert.strictEqual(p.__planner.S.tags[6].color, '#12AB34');
    assert.strictEqual($(p, '.hex'), hex, 'typing must not re-render the field');
    assert.ok(isColor($(p, '.hli .cpv').style.getPropertyValue('--c'), '#12AB34') || $(p, '.hli .cpv').getAttribute('style').includes('#12AB34'));
    typeIn(p, hex, 'zz'); assert.ok(hex.classList.contains('bad')); assert.strictEqual(p.__planner.S.tags[6].color, '#12AB34');
    setSel(p, hex, 'zz'); assert.strictEqual($(p, '.hex').value, '#12AB34');       // leaves the field: back to the last good colour
    click(p, $(p, '[data-a="tg-close"]'));
    assert.ok(!$(p, '.dlg'));
    assert.strictEqual($$(p, '.trow').length, 7); assert.match($$(p, '.trow')[6].textContent, /Reading/);
    d.window.close();
  });

  await t('a custom tag colours its tile; removing the tag moves the block to Personal', async () => {
    const d = boot({}); await wait(80); const p = d.window, P = p.PlannerLogic;
    click(p, $(p, '[data-a="tg-open"]')); click(p, $(p, '[data-a="tg-add"]'));
    typeIn(p, $$(p, '.dlg .hli')[6].querySelector('input'), 'Reading');
    click(p, $$(p, '.dlg .hli')[6].querySelector('.cswatch')); typeIn(p, $(p, '.hex'), '#FFD60A');
    click(p, $(p, '[data-a="tg-close"]'));
    click(p, $(p, '.hr[data-m="1200"]')); typeIn(p, $(p, '.qin'), 'Chapter 3');
    click(p, $$(p, '.quick .chip').find(c => /Reading/.test(c.textContent)));
    $(p, '.qin').dispatchEvent(new p.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const id = p.__planner.S.tags[6].id, d1 = P.tagById(p.__planner.S, id);
    assert.strictEqual(p.__planner.S.blocks[0].tag, id);
    let tile = $(p, '.tile');
    assert.ok(isColor(tile.style.backgroundColor, d1.fill), tile.style.backgroundColor + ' vs ' + d1.fill);
    assert.ok(isColor(tile.style.color, d1.text), tile.style.color + ' vs ' + d1.text);
    assert.match(tile.textContent, /Reading/);
    // remove the tag: confirm step, then the tile is Personal grey
    click(p, $(p, '[data-a="tg-open"]'));
    click(p, $$(p, '[data-a="tg-del"]')[6]); assert.match($$(p, '[data-a="tg-del"]')[6].textContent, /Confirm/);
    assert.strictEqual(p.__planner.S.tags.length, 7);
    click(p, $$(p, '[data-a="tg-del"]')[6]);
    assert.strictEqual(p.__planner.S.tags.length, 6); assert.strictEqual(p.__planner.S.blocks[0].tag, 'personal');
    click(p, $(p, '[data-a="tg-close"]'));
    tile = $(p, '.tile'); assert.match(tile.textContent, /Personal/);
    assert.ok(isColor(tile.style.backgroundColor, P.tagById(p.__planner.S, 'personal').fill));
    assert.strictEqual($$(p, '.trow').length, 6);
    // the last tag cannot be removed
    click(p, $(p, '[data-a="tg-open"]'));
    while ($$(p, '[data-a="tg-del"]').length > 1) { const b = $$(p, '[data-a="tg-del"]')[0]; click(p, b); click(p, $$(p, '[data-a="tg-del"]')[0]); }
    assert.strictEqual(p.__planner.S.tags.length, 1);
    assert.ok($(p, '[data-a="tg-del"]').disabled);
    click(p, $(p, '[data-a="tg-close"]'));
    assert.strictEqual($$(p, '.trow').length, 1); assert.strictEqual(p.__planner.S.blocks[0].tag, p.__planner.S.tags[0].id);
    d.window.close();
  });

  await t('habits use the same picker', async () => {
    const d = boot({}); await wait(80); const p = d.window, P = p.PlannerLogic;
    click(p, $(p, '[data-a="view"][data-v="habits"]')); click(p, $(p, '[data-a="hm-open"]'));
    assert.ok(!$(p, '.picker'));
    click(p, $$(p, '.hli .cswatch')[0]);
    assert.strictEqual($$(p, '.sw3').length, P.PALETTE.length);
    click(p, $$(p, '.sw3')[11]); assert.strictEqual(p.__planner.S.habits[0].color, P.PALETTE[11]);
    typeIn(p, $(p, '.hex'), '#12AB34'); assert.strictEqual(p.__planner.S.habits[0].color, '#12AB34');
    click(p, $$(p, '.hli .cswatch')[0]); assert.ok(!$(p, '.picker'));                   // swatch toggles the picker
    click(p, $(p, '[data-a="hm-close"]'));
    assert.ok($$(p, '.sc')[0].getAttribute('style').includes('#12AB34'));
    d.window.close();
  });

  await t('saves from before custom tags load with the six starting tags and are written back', async () => {
    const st = { 'data/users/m1/core': { v: 1, habits: [{ id: 'h-x', name: 'X', color: '#FF9F0A' }], tagHabit: {}, hiddenTags: [], years: [],
      blocks: [{ id: 'b1', title: 'Old block', tag: 'gym', start: 540, end: 600, habit: null, notes: '', rep: 'once', date: '2026-11-13' }] } };
    const cl = { use: async n => n === 'db' ? mkDb(st) : n === 'user' ? { id: async () => 'm1' } : { save: async () => {} } };
    const d = boot({ claude: cl }); await wait(1000);
    assert.strictEqual($$(d.window, '.trow').length, 6);
    assert.strictEqual($$(d.window, '.tile').length, 1); assert.match($(d.window, '.tile').textContent, /Gym/);
    const core = st['data/users/m1/core'];
    assert.ok(Array.isArray(core.tags) && core.tags.length === 6, 'tags written back');
    assert.strictEqual(core.blocks.length, 1);
    d.window.close();
  });

  await t('custom tags sync between devices', async () => {
    const shared = {}; const cl = { use: async n => n === 'db' ? mkDb(shared) : n === 'user' ? { id: async () => 'u7' } : { save: async () => {} } };
    const A = boot({ claude: cl }); const B = boot({ claude: cl }); await wait(150);
    click(A.window, $(A.window, '[data-a="tg-open"]')); click(A.window, $(A.window, '[data-a="tg-add"]'));
    typeIn(A.window, $$(A.window, '.dlg .hli')[6].querySelector('input'), 'Reading'); click(A.window, $(A.window, '[data-a="tg-close"]'));
    await wait(1600);
    assert.ok(shared['data/users/u7/core'].tags.some(x => x.name === 'Reading'));
    assert.strictEqual($$(B.window, '.trow').length, 7);
    A.window.close(); B.window.close();
  });

  await t('phone: Edit tags opens the Tags sheet; Data sheet links to it', async () => {
    const d = boot({ width: 390 }); await wait(100); const p = d.window;
    click(p, $(p, '[data-a="cal-toggle"]'));
    assert.ok($(p, '.phtags .chip.ed'));
    click(p, $(p, '.phtags .chip.ed')); assert.match($(p, '.dlg h2').textContent, /Tags/); assert.ok($(p, '.dlg .grab'));
    click(p, $(p, '[data-a="tg-close"]'));
    click(p, $(p, '.tabbar [data-a="data-open"]')); click(p, $(p, '.dlg [data-a="tg-open"]'));
    assert.match($(p, '.dlg h2').textContent, /Tags/); assert.strictEqual($$(p, '.dlg .hli').length, 6);
    d.window.close();
  });

  await t('phone Habits: date under each weekday letter, weekly counter on each card', async () => {
    const d = boot({ width: 390, claude: cloudFor(fixtureStore('f1'), 'f1') }); await wait(150); const p = d.window;
    click(p, $(p, '.tabbar [data-v="habits"]'));
    const cards = $$(p, '.hcard'); assert.strictEqual(cards.length, 3);
    const cols = [...cards[0].querySelectorAll('.wk button')];
    assert.strictEqual(cols.length, 7);
    assert.deepStrictEqual([...cols[0].children].map(e => e.tagName + (e.tagName === 'SPAN' ? '.' + e.className.split(' ')[0] : '')), ['EM', 'SMALL', 'SPAN.wc']);   // letter, date, circle
    assert.strictEqual(cols.map(c => c.querySelector('em').textContent).join(''), 'MTWTFSS');
    assert.strictEqual(cols.map(c => c.querySelector('small').textContent).join(','), '9,10,11,12,13,14,15');
    assert.strictEqual(cols[4].querySelector('small').className, 't'); assert.strictEqual(cols[4].querySelector('em').className, 't');   // today, Fri 13
    assert.ok(cols.every((c, i) => i === 4 || (!c.querySelector('small').className && !c.querySelector('em').className)));
    assert.ok(cols[2].querySelector('.wc.missed'));
    assert.deepStrictEqual(cards.map(c => c.querySelector('.wkc').textContent), ['4 of 5 this week', '5 of 5 this week', '0 of 1 this week']);
    // flip today's German circle: the counter follows at once
    click(p, cards[2].querySelectorAll('.wk button')[4]);
    assert.strictEqual($$(p, '.hcard')[2].querySelector('.wkc').textContent, '1 of 1 this week');
    click(p, $$(p, '.hcard')[2].querySelectorAll('.wk button')[4]);
    assert.strictEqual($$(p, '.hcard')[2].querySelector('.wkc').textContent, '0 of 1 this week');
    click(p, $$(p, '.hcard')[0].querySelectorAll('.wk button')[2]);                         // Gym Wed 11 back to done
    assert.strictEqual($$(p, '.hcard')[0].querySelector('.wkc').textContent, '5 of 5 this week');
    d.window.close();
    // the German block ends at 16:00: from then on it counts as done by itself
    const d2 = boot({ width: 390, claude: cloudFor(fixtureStore('f1b'), 'f1b') }); await wait(150); const q = d2.window;
    click(q, $(q, '.tabbar [data-v="habits"]')); assert.strictEqual($$(q, '.hcard')[2].querySelector('.wkc').textContent, '0 of 1 this week');
    q.__off = 2 * 3600e3;                                                                    // 16:20
    click(q, $(q, '.tabbar [data-v="day"]')); click(q, $(q, '.tabbar [data-v="habits"]'));
    assert.strictEqual($$(q, '.hcard')[2].querySelector('.wkc').textContent, '1 of 1 this week');
    d2.window.close();
  });

  await t('desktop Habits grid: Week column with done/planned this week', async () => {
    const d = boot({ claude: cloudFor(fixtureStore('f2'), 'f2') }); await wait(150); const p = d.window;
    click(p, $(p, '[data-a="view"][data-v="habits"]'));
    assert.match($(p, '.hrow.hd').textContent, /Week\s*W46/);
    const col = i => $$(p, '.hrow.b').map(r => r.querySelectorAll('.tot')[i].textContent);
    assert.deepStrictEqual(col(0), ['4/5', '5/5', '0/1']);       // this week
    assert.deepStrictEqual(col(1), ['9/10', '10/10', '1/1']);    // this month so far
    click(p, $(p, '.hrow.b .hc.missed'));                       // Gym Wed 11 back to done
    assert.deepStrictEqual(col(0), ['5/5', '5/5', '0/1']); assert.deepStrictEqual(col(1), ['10/10', '10/10', '1/1']);
    assert.strictEqual($$(p, '.hrow.hd .hdc').length, 30);
    d.window.close();
  });

  const cardText = (p) => {
    const c = $(p, '.mcard');
    return { title: c.querySelector('.mh .h3').textContent, pct: c.querySelector('.mbig b').textContent, sub: c.querySelector('.mbig span').textContent,
      weeks: [...c.querySelectorAll('.mw')].map(r => r.querySelector('.wl').textContent + ' ' + r.querySelector('.wn').textContent),
      chips: [...c.querySelectorAll('.mchip')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
      streaks: [...c.querySelectorAll('.mst')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) };
  };
  const monthNumbers = { title: 'November', pct: '95%', sub: '20 of 21 planned habit-days',
    weeks: ['W45 11/11', 'W46 9/11', 'W47 0/11', 'W48 0/11', 'W49 0/2'],
    chips: ['Gym 9/10', 'Study 10/10', 'German 1/1'],
    streaks: ['Best streak now 10 days Study', 'Longest this month 10 days Study'] };

  await t('phone Habits: monthly progress card above the habit cards', async () => {
    const d = boot({ width: 390, claude: cloudFor(fixtureStore('m1'), 'm1') }); await wait(150); const p = d.window;
    assert.ok(!$(p, '.mcard'), 'no monthly numbers on the Day view'); assert.ok($(p, '.ringw'));
    click(p, $(p, '.tabbar [data-v="habits"]'));
    assert.strictEqual(p.__scrolls[p.__scrolls.length - 1], 0, 'Habits opens at the top, not where the Day grid was scrolled to');
    assert.ok($(p, '.phabits > .mcard:first-child'));
    assert.strictEqual($$(p, '.phabits > *')[1].className, 'hcard');
    assert.deepStrictEqual(cardText(p), monthNumbers);
    assert.ok($(p, '.mw.cur .wl').textContent === 'W46');                                      // this week is marked
    assert.strictEqual($(p, '.mw .wbar i').style.width, '100%'); assert.strictEqual($$(p, '.mw .wbar i')[1].style.width, '82%');
    // tapping a chip scrolls to that habit's card
    p.Element.prototype.scrollIntoView = function () { (p.__sivs = p.__sivs || []).push(this.id); };
    click(p, $$(p, '.mchip')[1]);
    assert.deepStrictEqual(p.__sivs, ['hc-h-study']);
    assert.ok(p.document.getElementById('hc-h-study').classList.contains('flash'));
    assert.strictEqual(p.document.getElementById('hc-h-study').querySelector('.nm').textContent, 'Study');
    // live: flip Gym Wed 11 back to done, the numbers follow
    click(p, $$(p, '.hcard')[0].querySelectorAll('.wk button')[2]);
    const n = cardText(p); assert.strictEqual(n.pct, '100%'); assert.strictEqual(n.sub, '21 of 21 planned habit-days');
    assert.ok(n.chips[0] === 'Gym 10/10' && n.weeks[1] === 'W46 10/11');
    d.window.close();
  });

  await t('phone Habits: card follows the month and handles an empty month', async () => {
    const d = boot({ width: 390, claude: cloudFor(fixtureStore('m2'), 'm2') }); await wait(150); const p = d.window;
    click(p, $(p, '.tabbar [data-v="habits"]'));
    click(p, $(p, '.ph [data-a="prev"]'));
    const c = cardText(p);
    assert.strictEqual(c.title, 'October'); assert.strictEqual(c.pct, '–'); assert.strictEqual(c.sub, 'Nothing planned this month');
    assert.deepStrictEqual(c.weeks, []); assert.deepStrictEqual(c.chips, ['Gym –', 'Study –', 'German –']);
    click(p, $(p, '.ph [data-a="next"]')); click(p, $(p, '.ph [data-a="next"]'));
    assert.strictEqual(cardText(p).title, 'December'); assert.strictEqual(cardText(p).pct, '–');
    d.window.close();
    const e = boot({ width: 390 }); await wait(100);                                           // no habits planned at all
    click(e.window, $(e.window, '.tabbar [data-v="habits"]'));
    assert.strictEqual(cardText(e.window).sub, 'Nothing planned this month'); assert.match(cardText(e.window).streaks[0], /0 days$/);
    e.window.close();
  });

  await t('desktop Habits: the same card sits above the habit grid; Day view has none', async () => {
    const d = boot({ claude: cloudFor(fixtureStore('m3'), 'm3') }); await wait(150); const p = d.window;
    assert.ok(!$(p, '.mcard'));
    click(p, $(p, '[data-a="view"][data-v="habits"]'));
    assert.strictEqual($(p, '.hv').firstElementChild.className, 'card mcard');
    assert.ok($(p, '.mcard').compareDocumentPosition($(p, '.tw')) & p.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.deepStrictEqual(cardText(p), monthNumbers);
    p.Element.prototype.scrollIntoView = function () { (p.__sivs = p.__sivs || []).push(this.id); };
    click(p, $$(p, '.mchip')[0]); assert.deepStrictEqual(p.__sivs, ['hc-h-gym']);
    // desktop week column and the card agree on the current week
    const wkCol = $$(p, '.hrow.b').map(r => r.querySelectorAll('.tot')[0].textContent);
    assert.deepStrictEqual(wkCol, ['4/5', '5/5', '0/1']);
    click(p, $(p, '[data-a="view"][data-v="day"]')); assert.ok(!$(p, '.mcard'));
    d.window.close();
  });

  /* pointer events: jsdom has no layout, so tests move the pointer by clientY and the app converts pixels to minutes (52px = 1 hour) */
  const ptr = (w, type, el, y, kind) => {
    const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 300, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: 7 }); Object.defineProperty(e, 'pointerType', { value: kind || 'mouse' });
    el.dispatchEvent(e); return e;
  };
  const tileOf = (w, re) => $$(w, '.tile').find(t => re.test(t.textContent));
  const timesOf = (el) => el.querySelector('.tm').textContent.split(' · ')[0];
  function dragTile(w, el, from, to, kind) { ptr(w, 'pointerdown', el, from, kind); ptr(w, 'pointermove', el, (from + to) / 2, kind); ptr(w, 'pointermove', el, to, kind); ptr(w, 'pointerup', el, to, kind); }

  await t('drag: move a tile, snaps to 15 min, repeating block changes that day only, undo restores it', async () => {
    const d = boot({ claude: cloudFor(fixtureStore('d1'), 'd1') }); await wait(150); const w = d.window;
    let gym = tileOf(w, /Gym session/);
    assert.strictEqual(timesOf(gym), '08:00 – 09:00'); assert.ok(gym.querySelector('.rz-t') && gym.querySelector('.rz-b'));
    const body = gym.querySelector('.tbody');
    ptr(w, 'pointerdown', body, 100); ptr(w, 'pointermove', body, 101);
    assert.ok(!gym.classList.contains('drag'), 'a 1px wobble is not a drag');
    ptr(w, 'pointermove', body, 100 + 78);                                           // 78px = 90 minutes
    assert.ok(gym.classList.contains('drag'));
    assert.strictEqual(timesOf(gym), '09:30 – 10:30', 'live preview while dragging');
    assert.strictEqual(gym.style.top, (570 * 52 / 60 + 2) + 'px');
    ptr(w, 'pointerup', body, 100 + 78);
    gym = tileOf(w, /Gym session/);
    assert.strictEqual(timesOf(gym), '09:30 – 10:30'); assert.ok(!gym.classList.contains('drag'));
    assert.match($(w, '#toast').textContent, /Moved to 09:30 – 10:30, this day only/); assert.ok($(w, '#toast [data-a="undo"]'));
    const B = w.__planner.S.blocks;
    assert.strictEqual(B.length, 4); assert.strictEqual(B.find(b => b.id === 'bg').ex.length, 1);   // Fri 13 left the series
    assert.strictEqual(B.find(b => b.id === 'bg').start, 480);                                       // the series itself is untouched
    await wait(80);                                                                  // clicks right after a drop are ignored
    click(w, $(w, '#toast [data-a="undo"]'));
    gym = tileOf(w, /Gym session/);
    assert.strictEqual(timesOf(gym), '08:00 – 09:00'); assert.strictEqual(w.__planner.S.blocks.length, 3);
    assert.strictEqual($(w, '#toast').textContent, '');
    d.window.close();
  });

  await t('drag: resize from the bottom and the top edge, clamped to the day and 15 minutes', async () => {
    const d = boot({ claude: cloudFor(fixtureStore('d2'), 'd2') }); await wait(150); const w = d.window;
    let german = tileOf(w, /German/);
    dragTile(w, german.querySelector('.rz-b'), 500, 530);                             // 30px = 35 min -> +30 min
    german = tileOf(w, /German/); assert.strictEqual(timesOf(german), '15:00 – 16:30');
    assert.match($(w, '#toast').textContent, /Now 15:00 – 16:30/);
    let study = tileOf(w, /Study/);
    dragTile(w, study.querySelector('.rz-t'), 500, 552);                              // +60 min on the top edge
    study = tileOf(w, /Study/); assert.strictEqual(timesOf(study), '10:00 – 12:00');
    dragTile(w, study.querySelector('.rz-t'), 500, 5000);                             // far down: leaves 15 minutes
    study = tileOf(w, /Study/); assert.strictEqual(timesOf(study), '11:45 – 12:00');
    dragTile(w, study.querySelector('.rz-b'), 500, 9000);                             // far down: ends at 24:00
    study = tileOf(w, /Study/); assert.strictEqual(timesOf(study), '11:45 – 24:00');
    dragTile(w, study.querySelector('.tbody'), 500, -9000);                           // far up: starts at 00:00, keeps its length
    study = tileOf(w, /Study/); assert.strictEqual(timesOf(study), '00:00 – 12:15');
    d.window.close();
  });

  await t('drag: marks follow, the click that ends a drag opens nothing, a plain click still edits', async () => {
    const d = boot({ claude: cloudFor(fixtureStore('d3'), 'd3') }); await wait(150); const w = d.window;
    click(w, tileOf(w, /Gym session/).querySelector('.chk'));                        // Fri 13 Gym ended 09:00: now marked not done
    assert.ok(tileOf(w, /Gym session/).classList.contains('skip'));
    const body = tileOf(w, /Gym session/).querySelector('.tbody');
    dragTile(w, body, 100, 152);                                                       // +60 min
    click(w, tileOf(w, /Gym session/).querySelector('.tbody'));                       // the browser's click right after pointerup
    assert.ok(!$(w, '.dlg'), 'no editor after a drag');
    const g = tileOf(w, /Gym session/); assert.strictEqual(timesOf(g), '09:00 – 10:00'); assert.ok(g.classList.contains('skip'));
    await wait(80);
    click(w, g.querySelector('.tbody')); assert.ok($(w, '.dlg')); assert.strictEqual($(w, '#f-title').value, 'Gym session');
    click(w, $(w, '[data-a="d-cancel"]'));
    // pressing on the check circle never starts a drag
    const chk = tileOf(w, /Study/).querySelector('.chk'); ptr(w, 'pointerdown', chk, 100); ptr(w, 'pointermove', chk, 300); ptr(w, 'pointerup', chk, 300);
    assert.strictEqual(timesOf(tileOf(w, /Study/)), '09:00 – 12:00');
    // dropping where it started changes nothing and leaves no toast
    $(w, '#toast').innerHTML = '';
    dragTile(w, tileOf(w, /German/).querySelector('.tbody'), 100, 105);                // 5px is under half a 15-minute step
    assert.strictEqual(timesOf(tileOf(w, /German/)), '15:00 – 16:00'); assert.strictEqual($(w, '#toast').textContent, '');
    d.window.close();
  });

  await t('drag: Escape cancels, touch moves after a long press only, handles work at once', async () => {
    const d = boot({ claude: cloudFor(fixtureStore('d4'), 'd4') }); await wait(150); const w = d.window;
    let body = tileOf(w, /German/).querySelector('.tbody');
    ptr(w, 'pointerdown', body, 100); ptr(w, 'pointermove', body, 160);
    assert.notStrictEqual(timesOf(tileOf(w, /German/)), '15:00 – 16:00');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.strictEqual(timesOf(tileOf(w, /German/)), '15:00 – 16:00');
    ptr(w, 'pointerup', body, 160); assert.strictEqual(w.__planner.S.blocks.length, 3);
    // touch: moving at once is scrolling, not dragging
    body = tileOf(w, /German/).querySelector('.tbody');
    ptr(w, 'pointerdown', body, 100, 'touch'); ptr(w, 'pointermove', body, 200, 'touch'); ptr(w, 'pointerup', body, 200, 'touch');
    await wait(450); assert.strictEqual(timesOf(tileOf(w, /German/)), '15:00 – 16:00'); assert.strictEqual(w.__planner.S.blocks.length, 3);
    // touch: hold still for 350 ms, then drag
    body = tileOf(w, /German/).querySelector('.tbody');
    ptr(w, 'pointerdown', body, 100, 'touch'); await wait(400);
    assert.ok(tileOf(w, /German/).classList.contains('drag'));
    ptr(w, 'pointermove', body, 100 + 26, 'touch'); ptr(w, 'pointerup', body, 126, 'touch');   // 26px = 30 min
    assert.strictEqual(timesOf(tileOf(w, /German/)), '15:30 – 16:30');
    // touch on a resize handle needs no long press
    const bot = tileOf(w, /German/).querySelector('.rz-b');
    ptr(w, 'pointerdown', bot, 100, 'touch'); ptr(w, 'pointermove', bot, 126, 'touch'); ptr(w, 'pointerup', bot, 126, 'touch');
    assert.strictEqual(timesOf(tileOf(w, /German/)), '15:30 – 17:00');
    // the page does not scroll under a touch drag
    ptr(w, 'pointerdown', tileOf(w, /German/).querySelector('.tbody'), 100, 'touch'); await wait(400);
    const tm = new w.Event('touchmove', { bubbles: true, cancelable: true }); w.document.dispatchEvent(tm);
    assert.ok(tm.defaultPrevented); ptr(w, 'pointercancel', w.document.body, 100, 'touch');
    assert.ok(!tileOf(w, /German/).classList.contains('drag'));
    d.window.close();
  });

  await t('drag: changes are saved to the cloud and appear on another device', async () => {
    const shared = fixtureStore('d5'); const cl = cloudFor(shared, 'd5');
    const A = boot({ claude: cl }); const B = boot({ claude: cl }); await wait(200);
    dragTile(A.window, tileOf(A.window, /German/).querySelector('.rz-b'), 500, 552);
    await wait(1800);
    assert.strictEqual(timesOf(tileOf(B.window, /German/)), '15:00 – 17:00');
    A.window.close(); B.window.close();
  });

  await t('copy to another day: next day / next week / any date, copies what the dialog shows, saves, repeatable', async () => {
    const d = boot({ claude: cloudFor(fixtureStore('c1'), 'c1') }); await wait(150); const w = d.window;
    click(w, $(w, '[data-a="new"]')); assert.ok(!$(w, '#f-copy'), 'a new block has nothing to copy yet'); click(w, $(w, '[data-a="d-cancel"]'));
    click(w, tileOf(w, /Study/).querySelector('.tbody'));
    assert.strictEqual($(w, '#f-copy').value, '2026-11-14');                           // the day after the block's day
    typeIn(w, $(w, '#f-title'), 'Study (extra)'); click(w, $(w, '[data-a="d-tag"][data-t="work"]'));
    click(w, $(w, '[data-a="d-copy"]'));
    assert.match($(w, '.dlg').textContent, /Copied to Sat 14 Nov/);
    let S = w.__planner.S, c = S.blocks.find(b => b.date === '2026-11-14');
    assert.ok(c); assert.strictEqual(c.title, 'Study (extra)'); assert.strictEqual(c.tag, 'work');
    assert.strictEqual(JSON.stringify([c.start, c.end, c.rep]), JSON.stringify([540, 720, 'once']));
    assert.strictEqual(S.blocks.find(b => b.id === 'bs').title, 'Study');             // the original is not renamed by copying
    assert.strictEqual(S.blocks.length, 4);
    // next week, then a typed date: the dialog stays open for more copies
    click(w, $(w, '[data-a="d-copy-to"][data-n="7"]')); assert.strictEqual($(w, '#f-copy').value, '2026-11-20');
    assert.ok(!/Copied/.test($(w, '.dlg').textContent), 'old confirmation is cleared');
    click(w, $(w, '[data-a="d-copy"]'));
    setSel(w, $(w, '#f-copy'), '2026-12-24'); click(w, $(w, '[data-a="d-copy"]'));
    assert.strictEqual(w.__planner.S.blocks.length, 6);
    assert.ok(w.__planner.S.blocks.some(b => b.date === '2026-12-24'));
    // closing refreshes the day behind the dialog, and the copies show up on their days
    click(w, $(w, '[data-a="d-cancel"]'));
    assert.ok(!$(w, '.dlg')); assert.strictEqual($$(w, '.tile').length, 3);
    click(w, $(w, '[data-a="next"]')); assert.strictEqual($$(w, '.tile').length, 1); assert.match($(w, '.tile').textContent, /Study \(extra\)/);
    d.window.close();
  });

  await t('copy to another day: refuses the same day and bad dates, copies no done/skipped marks', async () => {
    const st = fixtureStore('c2'); const d = boot({ claude: cloudFor(st, 'c2') }); await wait(150); const w = d.window;
    click(w, tileOf(w, /Gym session/).querySelector('.chk'));                         // Fri 13 Gym: not done
    click(w, tileOf(w, /Gym session/).querySelector('.tbody'));
    setSel(w, $(w, '#f-copy'), '2026-11-13'); click(w, $(w, '[data-a="d-copy"]'));
    assert.match($(w, '.dlg .err').textContent, /different day/);
    setSel(w, $(w, '#f-copy'), ''); click(w, $(w, '[data-a="d-copy"]'));
    assert.match($(w, '.dlg .err').textContent, /Pick a date/);
    assert.strictEqual(w.__planner.S.blocks.length, 3);
    click(w, $(w, '[data-a="d-copy-to"][data-n="1"]'));
    assert.ok(!$(w, '.dlg .err'), 'the error clears when the date changes');
    click(w, $(w, '[data-a="d-copy"]')); click(w, $(w, '[data-a="d-cancel"]'));
    click(w, $(w, '[data-a="next"]'));
    const t2 = $(w, '.tile'); assert.match(t2.textContent, /Gym session/); assert.ok(!t2.classList.contains('skip'));
    assert.strictEqual(Object.keys(w.__planner.S.marks).filter(k => k.startsWith('b|2026-11-14')).length, 0);
    await wait(900);
    assert.strictEqual(st['data/users/c2/core'].blocks.length, 4);                    // saved to the cloud
    d.window.close();
  });

  const wtile = (w, d, re) => $$(w, '.wcol[data-d="' + d + '"] .tile').find(t => re.test(t.textContent));

  await t('week view: seven columns on a 24-hour axis, today marked, skipped block struck, prev/next/today', async () => {
    const d = boot({ claude: cloudFor(fixtureStore('w1'), 'w1') }); await wait(150); const w = d.window;
    assert.deepStrictEqual($$(w, '.seg button').map(b => b.textContent), ['Day', 'Week', 'Habits']);
    click(w, $(w, '.seg [data-v="week"]'));
    assert.ok($(w, '.wkv')); assert.ok(!$(w, '.grid'));
    assert.strictEqual($$(w, '.wkh').length, 7); assert.strictEqual($$(w, '.wcol').length, 7); assert.strictEqual($$(w, '.wh').length, 7 * 24);
    assert.strictEqual($(w, '.wkgrid').style.height, '1248px');
    assert.deepStrictEqual($$(w, '.wkh').map(b => b.textContent), ['Mon9', 'Tue10', 'Wed11', 'Thu12', 'Fri13', 'Sat14', 'Sun15']);
    assert.match($(w, '.top .ttl').textContent, /9 – 15 Nov 2026/); assert.match($(w, '.dayh').textContent, /Week 46/);
    assert.ok($(w, '.side .cgrid') && !$(w, '.hside'), 'calendar and tags beside the week, no single-day habit list');
    assert.ok($(w, '.wkh.today').textContent.includes('13') && $(w, '.wcol.today').dataset.d === '2026-11-13');
    assert.ok($(w, '.wcol.today .wnow') && $$(w, '.wnow').length === 1);
    assert.strictEqual($$(w, '.wcol .tile').length, 11);                                       // Mon-Fri Gym + Study, Fri German
    assert.strictEqual($$(w, '.wcol[data-d="2026-11-14"] .tile').length, 0);
    assert.ok(wtile(w, '2026-11-11', /Gym/).classList.contains('skip'));                     // marked not done on Wed
    assert.ok(!wtile(w, '2026-11-12', /Gym/).classList.contains('skip'));
    assert.strictEqual(wtile(w, '2026-11-13', /German/).querySelector('.tm').textContent, '15:00 – 16:00');
    assert.match($(w, '.dayh .prog').textContent, /of 11 blocks done/);
    click(w, $(w, '[data-a="next"]')); assert.match($(w, '.top .ttl').textContent, /16 – 22 Nov 2026/); assert.strictEqual($$(w, '.wcol .tile').length, 11);
    assert.strictEqual($(w, '.wkh').dataset.d, '2026-11-16'); assert.ok(!$(w, '.wcol.today') && !$(w, '.wnow'));
    click(w, $(w, '[data-a="prev"]')); click(w, $(w, '[data-a="prev"]')); assert.match($(w, '.top .ttl').textContent, /2 – 8 Nov 2026/);
    click(w, $(w, '[data-a="today"]')); assert.match($(w, '.top .ttl').textContent, /9 – 15 Nov 2026/);
    // the calendar moves the week without leaving the week view; tags hide blocks in it
    click(w, $(w, '.cd[data-d="2026-11-25"]')); assert.ok($(w, '.wkv')); assert.match($(w, '.top .ttl').textContent, /23 – 29 Nov 2026/);
    click(w, $(w, '[data-a="today"]'));
    click(w, $(w, '.side [data-a="tag"][data-t="gym"]')); assert.strictEqual($$(w, '.wcol .tile').length, 6);
    d.window.close();
  });

  await t('week view: header opens that day, hour opens New block for it, tile opens the editor, drag works', async () => {
    const st = fixtureStore('w2'); const d = boot({ claude: cloudFor(st, 'w2') }); await wait(150); const w = d.window;
    click(w, $(w, '.seg [data-v="week"]'));
    click(w, $$(w, '.wkh')[2]);                                                              // Wed 11 Nov
    assert.ok($(w, '.grid') && !$(w, '.wkv')); assert.match($(w, '.top .ttl').textContent, /Wednesday, 11 November 2026/);
    click(w, $(w, '.seg [data-v="week"]')); assert.ok($(w, '.wkh.sel').textContent.includes('11'), 'the opened day stays selected');
    click(w, $(w, '.wh[data-d="2026-11-14"][data-m="600"]'));                               // Sat 14, 10:00
    assert.ok($(w, '.dlg')); assert.strictEqual($(w, '#f-date').value, '2026-11-14'); assert.strictEqual($(w, '[data-f="d-start"]').value, '600'); assert.strictEqual($(w, '[data-f="d-end"]').value, '660');
    typeIn(w, $(w, '#f-title'), 'Brunch'); click(w, $(w, '[data-a="d-save"]'));
    assert.ok(!$(w, '.dlg')); assert.ok($(w, '.wkv'), 'saving keeps the week view');
    const brunch = wtile(w, '2026-11-14', /Brunch/); assert.ok(brunch); assert.strictEqual(brunch.querySelector('.tm').textContent, '10:00 – 11:00');
    click(w, $$(w, '.wh')[0]); assert.ok($(w, '#f-date').value === '2026-11-09' && $(w, '[data-f="d-start"]').value === '0'); click(w, $(w, '[data-a="d-cancel"]'));
    click(w, wtile(w, '2026-11-12', /Study/).querySelector('.tbody')); assert.strictEqual($(w, '#f-title').value, 'Study'); click(w, $(w, '[data-a="d-cancel"]'));
    // drag inside a column: Fri German 15:00 +90 min, that day only
    const ger = wtile(w, '2026-11-13', /German/); ptr(w, 'pointerdown', ger.querySelector('.tbody'), 100); ptr(w, 'pointermove', ger.querySelector('.tbody'), 178); ptr(w, 'pointerup', ger.querySelector('.tbody'), 178);
    assert.strictEqual(wtile(w, '2026-11-13', /German/).querySelector('.tm').textContent, '16:30 – 17:30');
    assert.match($(w, '#toast').textContent, /Moved to 16:30 – 17:30/);
    d.window.close();
  });

  await t('week view on a phone: Day, Week, Habits, Data tabs; compact columns; prev/next week; tap day header', async () => {
    const d = boot({ width: 390, claude: cloudFor(fixtureStore('w3'), 'w3') }); await wait(150); const p = d.window;
    assert.deepStrictEqual($$(p, '.tabbar button').map(b => b.textContent), ['Day', 'Week', 'Habits', 'Data']);
    click(p, $(p, '.tabbar [data-v="week"]'));
    assert.ok($(p, '.pmain .wkv') && $(p, '.fab') && !$(p, '.side')); assert.strictEqual($$(p, '.wcol').length, 7); assert.strictEqual($$(p, '.wcol .tile').length, 11);
    assert.match($(p, '.ph .mbtn').textContent, /9 – 15 Nov 2026/); assert.match($(p, '.ph-title .d1').textContent, /Week 46/);
    assert.ok(!$(p, '.ph [data-a="today"]'), 'no Today button on the current week');
    click(p, $(p, '.ph [data-a="next"]')); assert.match($(p, '.ph .mbtn').textContent, /16 – 22 Nov 2026/); assert.ok($(p, '.ph [data-a="today"]'));
    click(p, $(p, '.ph [data-a="today"]')); assert.match($(p, '.ph .mbtn').textContent, /9 – 15 Nov 2026/);
    click(p, $(p, '.fab')); assert.ok($(p, '.dlg')); click(p, $(p, '[data-a="d-cancel"]'));
    click(p, $$(p, '.wkh')[4]); assert.ok($(p, '.grid') && !$(p, '.wkv')); assert.match($(p, '.ph-title .d1').textContent, /Friday/);
    assert.ok($(p, '.tabbar [data-v="day"]').classList.contains('on'));
    click(p, $(p, '.tabbar [data-v="week"]')); assert.ok($(p, '.tabbar [data-v="week"]').classList.contains('on'));
    // swipe left on the week moves to the next week
    const tch = (type, x, y) => { const e = new p.Event(type, { bubbles: true }); e.touches = [{ clientX: x, clientY: y }]; e.changedTouches = [{ clientX: x, clientY: y }]; $(p, '.pmain').dispatchEvent(e); };
    tch('touchstart', 300, 300); tch('touchend', 150, 305); assert.match($(p, '.ph .mbtn').textContent, /16 – 22 Nov 2026/);
    d.window.close();
  });

  await t('own backend (plannerCloud) is used ahead of the Claude runtime', async () => {
    const mine = fixtureStore('o1'), theirs = {};
    const d = boot({ cloud: cloudFor(mine, 'o1'), claude: cloudFor(theirs, 'x') }); await wait(150); const w = d.window;
    assert.ok($$(w, '.tile').length > 0 && !$(w, '.banner'));
    assert.strictEqual(Object.keys(theirs).length, 0);
    click(w, $(w, '[data-a="data-open"]')); assert.ok($(w, '[data-a="signout"]'));
    d.window.close();
  });

  await t('own backend, signed out: only the sign-in card, nothing saved', async () => {
    const st = {}, signedOut = { use: async n => n === 'db' ? mkDb(st) : { id: async () => null }, signIn: async () => {} };
    const d = boot({ cloud: signedOut }); await wait(150); const w = d.window;
    assert.ok($(w, '[data-a="signin"]') && !$(w, '.tile') && !$(w, '.grid') && !$(w, '.banner'));
    await wait(700); assert.strictEqual(Object.keys(st).length, 0);
    assert.strictEqual(w.localStorage.getItem('planner.v1'), null);
    d.window.close();
  });

  console.log('\n' + pass + ' passed; page errors:', errors.length, errors.slice(0, 3));
  process.exit(process.exitCode || 0);
})();
