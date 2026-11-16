/* Weekly planner export: Firestore -> this Google Sheet, plus a JSON backup in Drive.
   Runs as you inside your Google account; no keys are stored anywhere.
   Setup: Extensions > Apps Script, paste this file and appsscript.json (Project Settings > show manifest),
   fill in the three values below, run setup() once and approve. Optional: run backfill() once for past weeks. */

var PROJECT_ID = 'daily-planner-b1bd5';   // Firebase console > Project settings
var OWNER_UID = 'OWNER_UID';              // the same uid as in firestore.rules
var SITE = 'https://pranavmaheshwari06.github.io/Daily-planner/';

var TABS = {
  Weeks: ['Week', 'Start', 'End', 'Habit-days planned', 'Done', 'Missed', 'Completion %', 'Hours planned', 'Hours done', 'Blocks skipped', 'Best streak', 'Exported at'],
  Habits: ['Week', 'Habit', 'Planned', 'Done', 'Missed', 'Completion %', 'Current streak'],
  Tags: ['Week', 'Tag', 'Hours planned', 'Hours done'],
  Blocks: ['Week', 'Date', 'Day', 'Start', 'End', 'Minutes', 'Title', 'Tag', 'Status']
};

/* Run once: builds the tabs and the Monday 00:00-01:00 trigger (the end of Sunday night, when every block of the week has ended). */
function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name), h = TABS[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#1C1C1E').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    var pct = h.indexOf('Completion %');
    if (pct >= 0) {
      var col = sh.getRange(2, pct + 1, sh.getMaxRows() - 1, 1).setNumberFormat('0%');
      sh.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().setGradientMaxpoint('#30D158')
        .setGradientMidpointWithValue('#FFD60A', SpreadsheetApp.InterpolationType.NUMBER, '0.5')
        .setGradientMinpoint('#FF453A').setRanges([col]).build()]);
    }
    h.forEach(function (name, i) { if (/^Hours/.test(name)) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('0.0'); });
    sh.autoResizeColumns(1, h.length);
  });
  var blank = ss.getSheetByName('Sheet1'); if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'weekly') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weekly').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(0).create();
}

/* The trigger: the week that just ended (Monday to Sunday). */
function weekly() {
  var L = loadLogic(), st = readState(L), today = L.dk(new Date());
  exportWeeks(L, st, [L.weekStart(L.addDays(today, -7))]);
  backup(L, st, L.weekStart(L.addDays(today, -7)));
}

/* Optional, run by hand: every past week from your first block up to last week. */
function backfill() {
  var L = loadLogic(), st = readState(L), today = L.dk(new Date()), weeks = [];
  for (var w = L.weekStart(L.earliest(st, today)); w < L.weekStart(today); w = L.addDays(w, 7)) weeks.push(w);
  exportWeeks(L, st, weeks);
}

/* Same tested logic as the app, loaded from the site so it never drifts. */
function loadLogic() {
  new Function(UrlFetchApp.fetch(SITE + 'logic.js').getContentText())();
  return globalThis.PlannerLogic;
}

function readState(L) {
  var core = getDoc('core');
  if (!core) throw new Error('No planner data found for ' + OWNER_UID);
  var marks = {};
  (core.years || []).forEach(function (y) { var d = getDoc('marks-' + y); if (d && d.m) Object.keys(d.m).forEach(function (k) { marks[k] = d.m[k]; }); });
  return L.normalize({ habits: core.habits, tags: core.tags, tagHabit: core.tagHabit, blocks: core.blocks, hiddenTags: core.hiddenTags, marks: marks });
}

/* Firestore REST as you: owner access, quota billed to the Firebase project. */
function getDoc(name) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/data/users/' + OWNER_UID + '/' + name;
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT_ID } });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('Firestore ' + r.getResponseCode() + ': ' + r.getContentText());
  return fields(JSON.parse(r.getContentText()).fields || {});
}
function fields(f) { var o = {}; Object.keys(f).forEach(function (k) { o[k] = value(f[k]); }); return o; }
function value(v) {
  if ('mapValue' in v) return fields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(value);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  return null;
}

function weekKey(L, ws) { var th = L.addDays(ws, 3); return th.slice(0, 4) + '-W' + L.pad(L.isoWeek(ws)); }

function exportWeeks(L, st, weekStarts) {
  var now = new Date(), DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], rows = { Weeks: [], Habits: [], Tags: [], Blocks: [] }, keys = {};
  weekStarts.forEach(function (ws) {
    var wk = weekKey(L, ws), we = L.addDays(ws, 6), tag = {}, mins = 0, doneMins = 0, skipped = 0, hp = 0, hd = 0, hm = 0, best = 0;
    keys[wk] = 1;
    for (var d = ws; d <= we; d = L.addDays(d, 1)) {
      L.occurrencesOn(st, d).forEach(function (o) {
        var s = L.occStatus(st, o, now), m = o.end - o.start, t = L.tagById(st, o.tag).name;
        tag[t] = tag[t] || [0, 0]; tag[t][0] += m; mins += m;
        if (s === 'd') { tag[t][1] += m; doneMins += m; } else if (s === 'x') skipped++;
        rows.Blocks.push([wk, d, DAYS[L.wd(d)], L.fmtMin(o.start), L.fmtMin(o.end), m, o.title, t, s === 'd' ? 'done' : s === 'x' ? 'skipped' : 'planned']);
      });
    }
    st.habits.forEach(function (h) {
      var r = L.weekStats(st, h.id, ws, now), k = L.streak(st, h.id, now);
      if (!r.planned) return;
      hp += r.planned; hd += r.done; hm += r.missed; best = Math.max(best, k);
      rows.Habits.push([wk, h.name, r.planned, r.done, r.missed, r.done + r.missed ? r.done / (r.done + r.missed) : '', k]);
    });
    Object.keys(tag).forEach(function (t) { rows.Tags.push([wk, t, tag[t][0] / 60, tag[t][1] / 60]); });
    rows.Weeks.push([wk, ws, we, hp, hd, hm, hd + hm ? hd / (hd + hm) : '', mins / 60, doneMins / 60, skipped, best, now]);
  });
  Object.keys(rows).forEach(function (name) { replaceWeeks(name, keys, rows[name]); });
}

/* Re-runnable: rows of the exported weeks are replaced, never duplicated. */
function replaceWeeks(name, keys, add) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Run setup() first');
  var n = sh.getLastRow() - 1, w = TABS[name].length;
  var keep = n > 0 ? sh.getRange(2, 1, n, w).getValues().filter(function (r) { return !keys[r[0]]; }) : [];
  var all = keep.concat(add).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  if (n > 0) sh.getRange(2, 1, n, w).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, w).setValues(all);
}

function backup(L, st, ws) {
  var it = DriveApp.getFoldersByName('Planner backups'), dir = it.hasNext() ? it.next() : DriveApp.createFolder('Planner backups');
  dir.createFile('planner-' + weekKey(L, ws) + '.json', JSON.stringify({ app: 'planner', v: 1, exported: new Date().toISOString(), state: st }), 'application/json');
}
