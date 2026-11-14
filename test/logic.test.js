const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../src/logic.js', 'utf8'), ctx);
const L = ctx.PlannerLogic;
let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n    ', e.message); process.exitCode = 1; } }
const at = (d, h, m) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h, m || 0);

// Fri 13 Nov 2026 14:20 is the reference "now"
const NOW = at('2026-11-13', 14, 20);

function base() {
  const s = L.newState();
  // Gym every weekday 08-09 from Mon 2 Nov, Study 09-12 weekdays, German Fri 15-16
  L.saveBlock(s, { id: null, date: '2026-11-02', title: 'Gym session', tag: 'gym', start: 480, end: 540, habit: 'h-gym', repeat: 'weekdays' });
  L.saveBlock(s, { id: null, date: '2026-11-02', title: 'Study', tag: 'study', start: 540, end: 720, habit: 'h-study', repeat: 'weekdays' });
  L.saveBlock(s, { id: null, date: '2026-11-13', title: 'German B1 practice', tag: 'german', start: 900, end: 960, habit: 'h-german', repeat: 'weekly' });
  return s;
}

t('weekday series occurs Mon-Fri only, not before start', () => {
  const s = base();
  assert.strictEqual(L.occurrencesOn(s, '2026-11-13').length, 3);      // Fri: gym, study, german
  assert.strictEqual(L.occurrencesOn(s, '2026-11-14').length, 0);      // Sat
  assert.strictEqual(L.occurrencesOn(s, '2026-10-30').length, 0);      // before start
  assert.strictEqual(L.occurrencesOn(s, '2026-11-12').length, 2);      // Thu: no German
});

t('blocks log themselves when they end', () => {
  const s = base();
  const occ = L.occurrencesOn(s, '2026-11-13');
  assert.strictEqual(L.occStatus(s, occ[0], NOW), 'd');   // gym ended
  assert.strictEqual(L.occStatus(s, occ[1], NOW), 'd');   // study ended 12:00
  assert.strictEqual(L.occStatus(s, occ[2], NOW), 'p');   // german later
  assert.strictEqual(L.occStatus(s, occ[2], at('2026-11-13', 16, 1)), 'd');
});

t('clicking an ended block marks it not done and back', () => {
  const s = base();
  const o = L.occurrencesOn(s, '2026-11-13')[0];
  L.toggleOcc(s, o, NOW);
  assert.strictEqual(L.occStatus(s, o, NOW), 'x');
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-13', NOW), 'missed');
  L.toggleOcc(s, o, NOW);
  assert.strictEqual(L.occStatus(s, o, NOW), 'd');
  assert.strictEqual(Object.keys(s.marks).length, 0);
});

t('clicking a future block marks done early and back', () => {
  const s = base();
  const o = L.occurrencesOn(s, '2026-11-13')[2];
  assert.strictEqual(L.habitDay(s, 'h-german', '2026-11-13', NOW), 'open');
  L.toggleOcc(s, o, NOW);
  assert.strictEqual(L.habitDay(s, 'h-german', '2026-11-13', NOW), 'done');
  L.toggleOcc(s, o, NOW);
  assert.strictEqual(L.habitDay(s, 'h-german', '2026-11-13', NOW), 'open');
});

t('habit days: none / upcoming / open / done', () => {
  const s = base();
  assert.strictEqual(L.habitDay(s, 'h-german', '2026-11-12', NOW), 'none');
  assert.strictEqual(L.habitDay(s, 'h-german', '2026-11-20', NOW), 'upcoming');
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-13', NOW), 'done');
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-14', NOW), 'none');
});

t('tracker click overrides, and block click clears the override', () => {
  const s = base();
  assert.ok(L.toggleHabit(s, 'h-gym', '2026-11-13', NOW));
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-13', NOW), 'missed');
  assert.ok(L.toggleHabit(s, 'h-gym', '2026-11-13', NOW));
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-13', NOW), 'done');
  assert.ok(!L.toggleHabit(s, 'h-gym', '2026-11-14', NOW));       // future days cannot be marked
  L.toggleHabit(s, 'h-gym', '2026-11-13', NOW);                    // override -> missed
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-13')[0], NOW);        // block click flips shown state back to done
  assert.strictEqual(s.marks['h|h-gym|2026-11-13'], undefined);
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-13', NOW), 'done');
});

t('manual tracker mark works on a day with no block', () => {
  const s = base();
  L.toggleHabit(s, 'h-sleep', '2026-11-12', NOW);
  assert.strictEqual(L.habitDay(s, 'h-sleep', '2026-11-12', NOW), 'done');
});

t('streak counts completed days and stops at a missed day', () => {
  const s = base();
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-11')[0], NOW);        // skip gym Wed 11
  // Nov 13 done, 12 done, 11 missed -> 2
  assert.strictEqual(L.streak(s, 'h-gym', NOW), 2);
  // study never skipped, runs from Mon 2 Nov over weekdays: 2..6, 9..13 = 10
  assert.strictEqual(L.streak(s, 'h-study', NOW), 10);
});

t('german weekly: Fri 13 done by Sat', () => {
  const s = base();
  assert.strictEqual(L.streak(s, 'h-german', at('2026-11-14', 10)), 1);
});

t('month stats', () => {
  const s = base();
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-11')[0], NOW);
  const m = L.monthStats(s, 'h-gym', 2026, 10, NOW);
  assert.strictEqual(JSON.stringify([m.done, m.missed, m.planned]), JSON.stringify([9, 1, 10]));  // 2-6 and 9-13 = 10 weekdays, one skipped
});

t('edit series this-and-following splits and keeps history', () => {
  const s = base();
  const gym = s.blocks[0];
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-12')[0], NOW);                 // skipped Thu 12 under old series
  const r = L.saveBlock(s, { id: gym.id, occDate: '2026-11-13', date: '2026-11-13', title: 'Gym legs', tag: 'gym', start: 1080, end: 1140, habit: 'h-gym', repeat: 'weekdays' });
  assert.ok(r.ok);
  const thu = L.occurrencesOn(s, '2026-11-12'), fri = L.occurrencesOn(s, '2026-11-13');
  assert.strictEqual(thu[0].title, 'Gym session');                           // past unchanged
  assert.strictEqual(L.occStatus(s, thu[0], NOW), 'x');                      // old mark kept
  const gf = fri.filter(o => o.title === 'Gym legs')[0];
  assert.ok(gf && gf.start === 1080);                                        // new from Fri on
  assert.strictEqual(fri.filter(o => o.title === 'Gym session').length, 0);
  assert.strictEqual(L.occurrencesOn(s, '2026-11-16').filter(o => o.title === 'Gym legs').length, 1);
  assert.strictEqual(gym.endDate, '2026-11-12');
});

t('split moves marks for edited day to the new series', () => {
  const s = base();
  const o = L.occurrencesOn(s, '2026-11-13')[0];
  L.toggleOcc(s, o, NOW);                                                     // skip gym today
  L.saveBlock(s, { id: o.id, occDate: '2026-11-13', date: '2026-11-13', title: 'Gym legs', tag: 'gym', start: 480, end: 540, habit: 'h-gym', repeat: 'weekdays' });
  const n = L.occurrencesOn(s, '2026-11-13').filter(x => x.title === 'Gym legs')[0];
  assert.strictEqual(L.occStatus(s, n, NOW), 'x');
});

t('only this day: series keeps going, one-off created', () => {
  const s = base();
  const o = L.occurrencesOn(s, '2026-11-17')[0];
  L.saveBlock(s, { id: o.id, occDate: '2026-11-17', date: '2026-11-18', title: 'Gym moved', tag: 'gym', start: 600, end: 660, habit: 'h-gym', repeat: 'once' });
  assert.strictEqual(L.occurrencesOn(s, '2026-11-17').filter(x => x.title === 'Gym session').length, 0);
  assert.strictEqual(L.occurrencesOn(s, '2026-11-18').filter(x => x.title === 'Gym moved').length, 1);
  assert.strictEqual(L.occurrencesOn(s, '2026-11-24').filter(x => x.title === 'Gym session').length, 1);
});

t('one-off converted to weekly', () => {
  const s = L.newState();
  const r = L.saveBlock(s, { id: null, date: '2026-11-13', title: 'Quick', tag: 'personal', start: 600, end: 660, repeat: 'once' });
  L.saveBlock(s, { id: r.id, occDate: '2026-11-13', date: '2026-11-13', title: 'Quick', tag: 'personal', start: 600, end: 660, repeat: 'weekly' });
  assert.strictEqual(L.occurrencesOn(s, '2026-11-20').length, 1);
  assert.strictEqual(L.occurrencesOn(s, '2026-11-14').length, 0);
});

t('delete: only this day / this and following / one-off', () => {
  const s = base();
  const g = s.blocks[0];
  L.deleteBlock(s, g.id, '2026-11-17', 'one');
  assert.strictEqual(L.occurrencesOn(s, '2026-11-17').filter(o => o.id === g.id).length, 0);
  assert.strictEqual(L.occurrencesOn(s, '2026-11-18').filter(o => o.id === g.id).length, 1);
  L.deleteBlock(s, g.id, '2026-11-18', 'following');
  assert.strictEqual(L.occurrencesOn(s, '2026-11-19').filter(o => o.id === g.id).length, 0);
  assert.strictEqual(L.occurrencesOn(s, '2026-11-13').filter(o => o.id === g.id).length, 1);   // history kept
});

t('validation', () => {
  const s = L.newState();
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: '  ', tag: 'gym', start: 600, end: 660, repeat: 'once' }).error);
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'x', tag: 'gym', start: 660, end: 600, repeat: 'once' }).error);
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'x', tag: 'gym', start: -15, end: 600, repeat: 'once' }).error);
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'x', tag: 'gym', start: 1380, end: 1500, repeat: 'once' }).error);   // may not cross midnight
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'x', tag: 'gym', start: 1440, end: 1500, repeat: 'once' }).error);
  assert.match(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'x', tag: 'gym', start: 1380, end: 1500, repeat: 'once' }).error, /00:00 and 24:00/);
});

t('full 24-hour day: 00:00 start and 24:00 end are valid', () => {
  const s = L.newState();
  assert.strictEqual(L.DAY_START, 0); assert.strictEqual(L.DAY_END, 1440);
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'Night shift', tag: 'work', start: 0, end: 360, repeat: 'once' }).ok);
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'Late', tag: 'personal', start: 1380, end: 1440, repeat: 'once' }).ok);
  assert.strictEqual(L.fmtMin(0), '00:00'); assert.strictEqual(L.fmtMin(1380), '23:00'); assert.strictEqual(L.fmtMin(1440), '24:00');
});

t('old blocks that ran past midnight are cut at 24:00 on import', () => {
  const s = L.newState();
  s.blocks.push({ id: 'a', title: 'Late', tag: 'personal', start: 1380, end: 1500, habit: null, notes: '', rep: 'once', date: '2026-11-13' });
  s.blocks.push({ id: 'b', title: 'After midnight', tag: 'personal', start: 1440, end: 1500, habit: null, notes: '', rep: 'once', date: '2026-11-13' });
  const n = L.normalize(JSON.parse(JSON.stringify(s)));
  assert.strictEqual(JSON.stringify([n.blocks[0].start, n.blocks[0].end]), JSON.stringify([1380, 1440]));
  assert.ok(n.blocks[1].start < n.blocks[1].end && n.blocks[1].end === 1440);
});

t('a block ending 24:00 logs itself at midnight', () => {
  const s = L.newState();
  L.saveBlock(s, { id: null, date: '2026-11-13', title: 'Late', tag: 'personal', start: 1380, end: 1440, repeat: 'once' });
  const o = L.occurrencesOn(s, '2026-11-13')[0];
  assert.strictEqual(L.occStatus(s, o, at('2026-11-13', 23, 59)), 'p');
  assert.strictEqual(L.occStatus(s, o, at('2026-11-14', 0, 0)), 'd');
});

t('overlap layout', () => {
  const o = [{ start: 540, end: 720 }, { start: 600, end: 660 }, { start: 720, end: 780 }];
  L.layoutDay(o);
  assert.strictEqual(JSON.stringify(o.map(x => [x.col, x.cols])), JSON.stringify([[0, 2], [1, 2], [0, 1]]));
});

t('delete habit unlinks blocks and clears its marks', () => {
  const s = base();
  L.toggleHabit(s, 'h-gym', '2026-11-13', NOW);
  L.deleteHabit(s, 'h-gym');
  assert.ok(!s.habits.some(h => h.id === 'h-gym'));
  assert.ok(s.blocks.every(b => b.habit !== 'h-gym'));
  assert.ok(!s.tagHabit.gym);
  assert.ok(!Object.keys(s.marks).some(k => k.indexOf('h|h-gym') === 0));
});

t('export/import round trip', () => {
  const s = base();
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-13')[0], NOW);
  const back = L.normalize(JSON.parse(JSON.stringify({ app: 'planner', v: 1, state: s })));
  assert.strictEqual(JSON.stringify(back.blocks), JSON.stringify(s.blocks));
  assert.strictEqual(JSON.stringify(back.marks), JSON.stringify(s.marks));
  assert.strictEqual(L.normalize({ nope: 1 }), null);
});

t('tracker click and block box always agree', () => {
  const s = base();
  const o = () => L.occurrencesOn(s, '2026-11-13')[0];
  L.toggleOcc(s, o(), NOW);                                   // skip
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-13', NOW), 'missed');
  L.toggleHabit(s, 'h-gym', '2026-11-13', NOW);               // tracker: back to done
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-13', NOW), 'done');
  assert.strictEqual(L.occStatus(s, o(), NOW), 'd');
  L.toggleHabit(s, 'h-gym', '2026-11-13', NOW);               // tracker: missed
  assert.strictEqual(L.occStatus(s, o(), NOW), 'x');
  L.toggleOcc(s, o(), NOW);                                   // block box flips to done
  assert.strictEqual(L.occStatus(s, o(), NOW), 'd');
  assert.strictEqual(L.habitDay(s, 'h-gym', '2026-11-13', NOW), 'done');
});

const plain = x => JSON.parse(JSON.stringify(x));      // objects made inside the vm context have another prototype
const wk = (s, h, d, now) => { const r = L.weekStats(s, h, d, now || NOW); return [r.done, r.missed, r.planned, r.upcoming]; };

t('weekStats: done, missed, planned and upcoming over Mon-Sun', () => {
  const s = base();
  // week of Mon 9 Nov, now Fri 13 14:20
  assert.deepStrictEqual(wk(s, 'h-gym', '2026-11-09'), [5, 0, 5, 0]);        // Mon-Fri gym all ended
  assert.deepStrictEqual(wk(s, 'h-study', '2026-11-09'), [5, 0, 5, 0]);
  assert.deepStrictEqual(wk(s, 'h-german', '2026-11-09'), [0, 0, 1, 1]);      // Friday 15:00 not ended: planned, still upcoming
  assert.deepStrictEqual(wk(s, 'h-sleep', '2026-11-09'), [0, 0, 0, 0]);      // nothing planned
  const r = L.weekStats(s, 'h-german', '2026-11-09', NOW);
  assert.strictEqual(r.planned, r.done + r.missed + r.upcoming);
});

t('weekStats: any day of the week gives the same week, and the week before the series is empty', () => {
  const s = base();
  ['2026-11-09', '2026-11-11', '2026-11-15'].forEach(d => assert.deepStrictEqual(wk(s, 'h-gym', d), [5, 0, 5, 0]));
  assert.deepStrictEqual(wk(s, 'h-gym', '2026-10-26'), [0, 0, 0, 0]);        // series starts Mon 2 Nov
  assert.deepStrictEqual(wk(s, 'h-gym', '2026-11-02'), [5, 0, 5, 0]);
});

t('weekStats: days still to come count as planned and upcoming', () => {
  const s = base();
  assert.deepStrictEqual(wk(s, 'h-gym', '2026-11-16'), [0, 0, 5, 5]);        // next week, nothing happened yet
  assert.deepStrictEqual(wk(s, 'h-german', '2026-11-16'), [0, 0, 1, 1]);
});

t('weekStats follows the clock and clicks: block ends, circle flipped, done early', () => {
  const s = base();
  assert.deepStrictEqual(wk(s, 'h-german', '2026-11-09', at('2026-11-13', 15, 59)), [0, 0, 1, 1]);
  assert.deepStrictEqual(wk(s, 'h-german', '2026-11-09', at('2026-11-13', 16, 0)), [1, 0, 1, 0]);   // the moment the block ends
  L.toggleHabit(s, 'h-gym', '2026-11-13', NOW);                                                    // circle flipped to missed
  assert.deepStrictEqual(wk(s, 'h-gym', '2026-11-09'), [4, 1, 5, 0]);
  L.toggleHabit(s, 'h-gym', '2026-11-13', NOW);
  assert.deepStrictEqual(wk(s, 'h-gym', '2026-11-09'), [5, 0, 5, 0]);
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-13')[2], NOW);                                        // German ticked early
  assert.deepStrictEqual(wk(s, 'h-german', '2026-11-09'), [1, 0, 1, 0]);
});

t('weekStats: a manual mark on a day without a block counts as planned', () => {
  const s = base();
  L.toggleHabit(s, 'h-sleep', '2026-11-12', NOW);
  assert.deepStrictEqual(wk(s, 'h-sleep', '2026-11-09'), [1, 0, 1, 0]);
  L.toggleHabit(s, 'h-sleep', '2026-11-12', NOW);                                                  // flipped to missed
  assert.deepStrictEqual(wk(s, 'h-sleep', '2026-11-09'), [0, 1, 1, 0]);
});

/* Gym and Study every weekday from Mon 2 Nov, German on Fridays from 6 Nov, Gym skipped on Wed 11. Clock: Fri 13 Nov 14:20. */
function monthState() {
  const s = L.newState();
  L.saveBlock(s, { id: null, date: '2026-11-02', title: 'Gym session', tag: 'gym', start: 480, end: 540, habit: 'h-gym', repeat: 'weekdays' });
  L.saveBlock(s, { id: null, date: '2026-11-02', title: 'Study', tag: 'study', start: 540, end: 720, habit: 'h-study', repeat: 'weekdays' });
  L.saveBlock(s, { id: null, date: '2026-11-06', title: 'German B1 practice', tag: 'german', start: 900, end: 960, habit: 'h-german', repeat: 'weekly' });
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-11').filter(o => o.title === 'Gym session')[0], NOW);
  return s;
}

t('monthSummary: completion, planned habit-days, per-habit counts', () => {
  const m = L.monthSummary(monthState(), 2026, 10, NOW);
  assert.strictEqual(JSON.stringify([m.done, m.missed, m.planned, m.pct]), JSON.stringify([20, 1, 21, 95]));   // 9+10+1 done, Gym Wed 11 missed
  assert.strictEqual(m.planned, m.done + m.missed);
  const h = Object.fromEntries(m.habits.map(x => [x.id, [x.done, x.planned]]));
  assert.deepStrictEqual(h['h-gym'], [9, 10]); assert.deepStrictEqual(h['h-study'], [10, 10]); assert.deepStrictEqual(h['h-german'], [1, 1]);
  assert.deepStrictEqual(h['h-sleep'], [0, 0]);
  assert.strictEqual(m.habits.length, 5);
});

t('monthSummary: week rows are clipped to the month and match weekStats', () => {
  const s = monthState(), m = L.monthSummary(s, 2026, 10, NOW);
  assert.deepStrictEqual(plain(m.weeks.map(w => [w.week, w.start, w.end, w.done, w.missed, w.upcoming, w.planned])), [
    [44, '2026-11-01', '2026-11-01', 0, 0, 0, 0],      // Sun 1 Nov only, nothing planned
    [45, '2026-11-02', '2026-11-08', 11, 0, 0, 11],
    [46, '2026-11-09', '2026-11-15', 9, 1, 1, 11],     // Gym 4 + Study 5 + German still to come
    [47, '2026-11-16', '2026-11-22', 0, 0, 11, 11],
    [48, '2026-11-23', '2026-11-29', 0, 0, 11, 11],
    [49, '2026-11-30', '2026-11-30', 0, 0, 2, 2]]);    // Mon 30 Nov only
  const sum = k => m.weeks.reduce((a, w) => a + w[k], 0);
  assert.strictEqual(sum('done'), m.done); assert.strictEqual(sum('missed'), m.missed);
  m.weeks.forEach(w => assert.strictEqual(w.planned, w.done + w.missed + w.upcoming));
  // the full-week rows are exactly the weekly counters of every habit added up
  const w46 = s.habits.reduce((a, h) => { const r = L.weekStats(s, h.id, '2026-11-09', NOW); return [a[0] + r.done, a[1] + r.planned]; }, [0, 0]);
  assert.deepStrictEqual(w46, [m.weeks[2].done, m.weeks[2].planned]);
});

t('monthSummary: best current streak and longest streak this month', () => {
  const m = L.monthSummary(monthState(), 2026, 10, NOW);
  assert.deepStrictEqual(plain(m.bestStreak), { count: 10, id: 'h-study', name: 'Study' });         // Study done every weekday since 2 Nov
  assert.deepStrictEqual(plain(m.longestStreak), { count: 10, id: 'h-study', name: 'Study' });
  const s = monthState();
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-12').filter(o => o.title === 'Study')[0], NOW);  // Study skipped Thu 12
  const n = L.monthSummary(s, 2026, 10, NOW);
  assert.deepStrictEqual(plain(n.longestStreak), { count: 8, id: 'h-study', name: 'Study' });         // Study 2-6 and 9-11 beats Gym 2-6 and 9-10 (Wed 11 missed)
  assert.deepStrictEqual(plain(n.bestStreak), { count: 2, id: 'h-gym', name: 'Gym' });               // Gym 12, 13 vs Study 13 only
});

t('monthSummary: months with nothing decided', () => {
  const s = monthState();
  const oct = L.monthSummary(s, 2026, 9, NOW);                                               // before anything was planned
  assert.strictEqual(JSON.stringify([oct.done, oct.missed, oct.planned, oct.pct]), JSON.stringify([0, 0, 0, null]));
  assert.ok(oct.weeks.every(w => w.planned === 0));
  assert.strictEqual(oct.longestStreak.count, 0);
  const dec = L.monthSummary(s, 2026, 11, NOW);                                              // future: planned days are all upcoming
  assert.strictEqual(dec.planned, 0); assert.strictEqual(dec.pct, null);
  assert.ok(dec.weeks.some(w => w.upcoming > 0));
  const empty = L.monthSummary(L.newState(), 2026, 10, NOW);
  assert.strictEqual(empty.planned, 0); assert.strictEqual(empty.bestStreak.count, 0); assert.strictEqual(empty.bestStreak.id, null);
});

t('monthSummary follows clicks and the clock', () => {
  const s = monthState();
  L.toggleHabit(s, 'h-gym', '2026-11-11', NOW);                                              // Gym Wed 11 back to done
  let m = L.monthSummary(s, 2026, 10, NOW);
  assert.strictEqual(JSON.stringify([m.done, m.missed, m.planned, m.pct]), JSON.stringify([21, 0, 21, 100]));
  m = L.monthSummary(s, 2026, 10, at('2026-11-13', 16, 0));                                  // German block ends
  assert.strictEqual(JSON.stringify([m.done, m.planned]), JSON.stringify([22, 22]));
  assert.strictEqual(m.weeks[2].upcoming, 0);
});

t('dragTimes: move snaps to 15 minutes and stays inside the day', () => {
  const m = (a, b, d) => JSON.stringify(L.dragTimes(a, b, 'move', d));
  assert.strictEqual(m(480, 540, 0), JSON.stringify({ start: 480, end: 540 }));
  assert.strictEqual(m(480, 540, 90), JSON.stringify({ start: 570, end: 630 }));
  assert.strictEqual(m(480, 540, 7), JSON.stringify({ start: 480, end: 540 }));          // under half a step: no change
  assert.strictEqual(m(480, 540, 8), JSON.stringify({ start: 495, end: 555 }));
  assert.strictEqual(m(480, 540, -59), JSON.stringify({ start: 420, end: 480 }));
  assert.strictEqual(m(480, 540, -9999), JSON.stringify({ start: 0, end: 60 }));        // stops at 00:00 and keeps its length
  assert.strictEqual(m(480, 660, 9999), JSON.stringify({ start: 1260, end: 1440 }));    // stops at 24:00
});

t('dragTimes: resize from either edge, 15 minutes minimum', () => {
  const b = (a, e, d) => JSON.stringify(L.dragTimes(a, e, 'bottom', d)), tp = (a, e, d) => JSON.stringify(L.dragTimes(a, e, 'top', d));
  assert.strictEqual(b(540, 600, 30), JSON.stringify({ start: 540, end: 630 }));
  assert.strictEqual(b(540, 600, -9999), JSON.stringify({ start: 540, end: 555 }));
  assert.strictEqual(b(540, 600, 9999), JSON.stringify({ start: 540, end: 1440 }));
  assert.strictEqual(tp(540, 600, -30), JSON.stringify({ start: 510, end: 600 }));
  assert.strictEqual(tp(540, 600, 9999), JSON.stringify({ start: 585, end: 600 }));
  assert.strictEqual(tp(540, 600, -9999), JSON.stringify({ start: 0, end: 600 }));
});

t('retimeBlock: a one-off changes in place and keeps its marks', () => {
  const s = L.newState();
  const id = L.saveBlock(s, { id: null, date: '2026-11-13', title: 'Once', tag: 'gym', start: 480, end: 540, habit: 'h-gym', repeat: 'once' }).id;
  L.toggleOcc(s, L.occurrencesOn(s, '2026-11-13')[0], NOW);                     // skipped
  const r = L.retimeBlock(s, '2026-11-13|' + id, 600, 690);
  assert.ok(r.ok && !r.series);
  const o = L.occurrencesOn(s, '2026-11-13')[0];
  assert.strictEqual(JSON.stringify([o.id, o.start, o.end]), JSON.stringify([id, 600, 690]));
  assert.strictEqual(L.occStatus(s, o, NOW), 'x');
  assert.strictEqual(s.blocks.length, 1);
});

t('retimeBlock: a repeating block changes on that day only, marks follow', () => {
  const s = base();
  const gym = L.occurrencesOn(s, '2026-11-13')[0];
  L.toggleOcc(s, gym, NOW);                                                     // Fri 13 skipped
  const r = L.retimeBlock(s, gym.key, 570, 630);
  assert.ok(r.ok && r.series);
  const fri = L.occurrencesOn(s, '2026-11-13').filter(o => o.title === 'Gym session');
  assert.strictEqual(fri.length, 1); assert.strictEqual(fri[0].start, 570); assert.strictEqual(fri[0].rep, 'once');
  assert.strictEqual(L.occStatus(s, fri[0], NOW), 'x');                          // skip mark kept
  const thu = L.occurrencesOn(s, '2026-11-12').filter(o => o.title === 'Gym session')[0], mon = L.occurrencesOn(s, '2026-11-16').filter(o => o.title === 'Gym session')[0];
  assert.strictEqual(thu.start, 480); assert.strictEqual(mon.start, 480);        // other days untouched
});

t('retimeBlock: no change, bad times, unknown block', () => {
  const s = base(), o = L.occurrencesOn(s, '2026-11-13')[0], n = s.blocks.length;
  assert.ok(L.retimeBlock(s, o.key, o.start, o.end).same); assert.strictEqual(s.blocks.length, n);
  assert.ok(L.retimeBlock(s, o.key, 600, 600).error);
  assert.ok(L.retimeBlock(s, o.key, -15, 60).error);
  assert.ok(L.retimeBlock(s, o.key, 1380, 1500).error);
  assert.ok(L.retimeBlock(s, '2026-11-13|nope', 600, 660).error);
  assert.strictEqual(s.blocks.length, n);                                         // failed attempts change nothing
  assert.strictEqual(L.occurrencesOn(s, '2026-11-13')[0].start, 480);
});

t('copyBlock: one-off on another day, marks and series are not copied', () => {
  const s = base(), gym = L.occurrencesOn(s, '2026-11-13')[0];
  L.toggleOcc(s, gym, NOW);                                                       // skipped on the 13th
  const f = { title: gym.title, tag: gym.tag, start: gym.start, end: gym.end, habit: gym.habit, notes: 'bring towel' };
  const r = L.copyBlock(s, f, '2026-11-14', '2026-11-13');                        // a Saturday: the series does not run there
  assert.ok(r.ok);
  const c = L.occurrencesOn(s, '2026-11-14');
  assert.strictEqual(c.length, 1); assert.strictEqual(c[0].title, 'Gym session'); assert.strictEqual(c[0].rep, 'once');
  assert.strictEqual(c[0].notes, 'bring towel'); assert.strictEqual(c[0].habit, 'h-gym'); assert.strictEqual(L.occStatus(s, c[0], at('2026-11-15', 12)), 'd');
  assert.strictEqual(L.occurrencesOn(s, '2026-11-21').length, 0);                  // a one-off, no repeat
  assert.strictEqual(L.occStatus(s, L.occurrencesOn(s, '2026-11-13')[0], NOW), 'x');   // original untouched
});

t('copyBlock: validates the date and the block', () => {
  const s = base(), n = s.blocks.length, f = { title: 'x', tag: 'gym', start: 600, end: 660, habit: null, notes: '' };
  assert.match(L.copyBlock(s, f, '2026-11-13', '2026-11-13').error, /different day/);
  ['', 'tomorrow', '2026-02-30', '2026-13-01', '13/11/2026', null, undefined].forEach(d => assert.ok(L.copyBlock(s, f, d, '2026-11-13').error, String(d)));
  assert.ok(L.copyBlock(s, { ...f, title: ' ' }, '2026-11-20', '2026-11-13').error);
  assert.ok(L.copyBlock(s, { ...f, start: 1380, end: 1500 }, '2026-11-20', '2026-11-13').error);
  assert.strictEqual(s.blocks.length, n);
  assert.ok(L.validDate('2028-02-29')); assert.ok(!L.validDate('2026-02-29'));
});

t('ISO week numbers', () => {
  assert.strictEqual(L.isoWeek('2026-11-13'), 46); assert.strictEqual(L.isoWeek('2026-11-09'), 46); assert.strictEqual(L.isoWeek('2026-11-15'), 46);
  assert.strictEqual(L.isoWeek('2026-11-02'), 45); assert.strictEqual(L.isoWeek('2026-01-01'), 1); assert.strictEqual(L.isoWeek('2026-12-31'), 53);
});

t('tags are data in state; the six starting tags keep their ids', () => {
  const s = L.newState();
  assert.strictEqual(JSON.stringify(s.tags.map(x => x.id)), JSON.stringify(['work', 'study', 'gym', 'german', 'jobs', 'personal']));
  assert.ok(s.tags.every(x => /^#[0-9A-F]{6}$/.test(x.color) && x.name));
  assert.strictEqual(L.tagById(s, 'gym').name, 'Gym');
  assert.strictEqual(L.tagById(s, 'gone').id, 'personal');                  // unknown id falls back to Personal
});

t('saves from before custom tags are migrated: six tags, blocks keep their tag', () => {
  const old = { app: 'planner', v: 1, state: { habits: [{ id: 'h-gym', name: 'Gym', color: '#30D158' }], tagHabit: { gym: 'h-gym' }, hiddenTags: ['study'], marks: {},
    blocks: [{ id: 'b1', title: 'Gym', tag: 'gym', start: 480, end: 540, habit: 'h-gym', notes: '', rep: 'once', date: '2026-11-13' }] } };
  const n = L.normalize(old);
  assert.strictEqual(n.tags.length, 6);
  assert.strictEqual(n.blocks[0].tag, 'gym');
  assert.strictEqual(JSON.stringify(n.hiddenTags), JSON.stringify(['study']));
  assert.strictEqual(n.tagHabit.gym, 'h-gym');
});

t('hex input: 3 and 6 digits, with or without #, rejects the rest', () => {
  assert.strictEqual(L.normHex('#0a84ff'), '#0A84FF');
  assert.strictEqual(L.normHex('0a84ff'), '#0A84FF');
  assert.strictEqual(L.normHex(' #f0a '), '#FF00AA');
  ['', '#12', '#12345', '#1234567', 'blue', '#GGGGGG', null, undefined].forEach(v => assert.strictEqual(L.normHex(v), null, String(v)));
});

t('derived tile colours are readable for any picked colour', () => {
  const colors = ['#000000', '#FFFFFF', '#FFD60A', '#0A0A0A', '#8E8E93', '#222266', '#00FF00', '#FF0000', '#123456', '#FEDCBA'].concat(L.PALETTE);
  for (let h = 0; h < 360; h += 15) for (const l of [20, 50, 80]) {            // a sweep of hues and lightnesses
    const f = (n) => { const k = (n + h / 30) % 12, a = 0.8 * Math.min(l / 100, 1 - l / 100); return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    colors.push('#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase());
  }
  colors.forEach(c => {
    const s = L.newState(); L.updateTag(s, 'work', { color: c });
    const d = L.tagById(s, 'work');
    assert.strictEqual(d.color, d.box); assert.strictEqual(d.color, c.toUpperCase());
    assert.ok(L.contrast(d.text, d.fill) >= 4.5, c + ' text/fill ' + L.contrast(d.text, d.fill).toFixed(2));
    assert.ok(L.contrast(d.chk, d.box) >= 3, c + ' check/box ' + L.contrast(d.chk, d.box).toFixed(2));
  });
});

t('one colour gives the tile fill, text and check colours', () => {
  const s = L.newState();
  L.updateTag(s, 'work', { color: '#0A84FF' });
  let d = L.tagById(s, 'work');
  assert.strictEqual(d.fill, '#032547'); assert.strictEqual(d.text, '#A9D4FF'); assert.strictEqual(d.box, '#0A84FF'); assert.strictEqual(d.chk, '#FFFFFF');
  L.updateTag(s, 'work', { color: '#30D158' });
  d = L.tagById(s, 'work');
  assert.strictEqual(d.fill, '#0D3B19'); assert.strictEqual(d.text, '#B7EFC5'); assert.strictEqual(d.chk, '#111111');          // light colour: dark check mark
  assert.strictEqual(L.habitChk('#FFD60A'), '#111111'); assert.strictEqual(L.habitChk('#5E5CE6'), '#FFFFFF');
});

t('add, rename and recolour a tag', () => {
  const s = L.newState();
  assert.ok(L.addTag(s, '  Reading ', '12ab34').ok);
  const t = s.tags[s.tags.length - 1];
  assert.strictEqual(t.name, 'Reading'); assert.strictEqual(t.color, '#12AB34'); assert.ok(/^t-/.test(t.id));
  assert.ok(L.updateTag(s, t.id, { name: 'Books' }).ok); assert.strictEqual(L.tagById(s, t.id).name, 'Books');
  assert.ok(L.updateTag(s, t.id, { color: '#f00' }).ok); assert.strictEqual(L.tagById(s, t.id).color, '#FF0000');
  assert.ok(L.updateTag(s, t.id, { name: '   ' }).error);                    // blank name rejected, old name kept
  assert.ok(L.updateTag(s, t.id, { color: 'red' }).error);
  assert.strictEqual(L.tagById(s, t.id).name, 'Books'); assert.strictEqual(L.tagById(s, t.id).color, '#FF0000');
  assert.ok(L.addTag(s, '', '#FFFFFF').error); assert.ok(L.addTag(s, 'x', 'nope').error);
  assert.strictEqual(L.addTag(s, 'x'.repeat(40), '#FFFFFF').ok && s.tags[s.tags.length - 1].name.length, 24);
});

t('a custom tag can be used by blocks, and survives export and import', () => {
  const s = L.newState();
  const id = L.addTag(s, 'Reading', '#12AB34').id;
  const r = L.saveBlock(s, { id: null, date: '2026-11-13', title: 'Chapter 3', tag: id, start: 1200, end: 1260, repeat: 'once' });
  assert.ok(r.ok); assert.strictEqual(L.occurrencesOn(s, '2026-11-13')[0].tag, id);
  const back = L.normalize(JSON.parse(JSON.stringify({ app: 'planner', v: 1, state: s })));
  assert.strictEqual(JSON.stringify(back.tags), JSON.stringify(s.tags));
  assert.strictEqual(back.blocks[0].tag, id);
});

t('delete tag: blocks move to Personal, filter and habit link are cleaned, last tag stays', () => {
  const s = base();
  s.hiddenTags.push('gym');
  const res = L.deleteTag(s, 'gym');
  assert.ok(res.ok); assert.strictEqual(res.movedTo, 'personal');
  assert.ok(!s.tags.some(x => x.id === 'gym'));
  assert.ok(s.blocks.every(b => b.tag !== 'gym'));
  assert.strictEqual(s.blocks[0].tag, 'personal'); assert.strictEqual(s.blocks[0].habit, 'h-gym');   // habit link untouched
  assert.ok(!s.hiddenTags.includes('gym')); assert.ok(!('gym' in s.tagHabit));
  assert.ok(L.deleteTag(s, 'nope').error);
  // without Personal, the last tag left takes over
  const u = L.newState(); L.deleteTag(u, 'personal');
  L.saveBlock(u, { id: null, date: '2026-11-13', title: 'x', tag: 'jobs', start: 600, end: 660, repeat: 'once' });
  assert.strictEqual(L.deleteTag(u, 'jobs').movedTo, 'german');
  assert.strictEqual(u.blocks[0].tag, 'german');
  // keep one
  const one = L.newState(); one.tags = [one.tags[0]];
  assert.match(L.deleteTag(one, 'work').error, /at least one/);
  assert.strictEqual(one.tags.length, 1);
});

t('new blocks with an unknown tag land on Personal', () => {
  const s = L.newState();
  L.saveBlock(s, { id: null, date: '2026-11-13', title: 'x', tag: 'ghost', start: 600, end: 660, repeat: 'once' });
  assert.strictEqual(s.blocks[0].tag, 'personal');
});

console.log('\n' + pass + ' passed');
