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
    } });
}
const $ = (w, s) => w.document.querySelector(s), $$ = (w, s) => [...w.document.querySelectorAll(s)];
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
function typeIn(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); }
function setSel(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); }

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
    click(p, $$(p, '.tabbar button')[1]); assert.strictEqual($$(p, '.hcard').length, 5);
    assert.strictEqual($$(p, '.hcard')[0].querySelectorAll('.wk button').length, 7);
    click(p, $$(p, '.tabbar button')[2]); assert.ok($(p, '.dlg'));
    d.window.close();
  });

  console.log('\n' + pass + ' passed; page errors:', errors.length, errors.slice(0, 3));
  process.exit(process.exitCode || 0);
})();
