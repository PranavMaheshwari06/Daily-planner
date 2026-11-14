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
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'x', tag: 'gym', start: 420, end: 600, repeat: 'once' }).error);
  assert.ok(L.saveBlock(s, { id: null, date: '2026-11-13', title: 'late', tag: 'gym', start: 1440, end: 1500, repeat: 'once' }).ok);
});

t('a block ending 01:00 logs itself only after 01:00 next day', () => {
  const s = L.newState();
  L.saveBlock(s, { id: null, date: '2026-11-13', title: 'Late', tag: 'personal', start: 1380, end: 1500, repeat: 'once' });
  const o = L.occurrencesOn(s, '2026-11-13')[0];
  assert.strictEqual(L.occStatus(s, o, at('2026-11-14', 0, 30)), 'p');
  assert.strictEqual(L.occStatus(s, o, at('2026-11-14', 1, 0)), 'd');
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

console.log('\n' + pass + ' passed');
