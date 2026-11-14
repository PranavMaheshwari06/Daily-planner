/* Planner logic: dates, recurrence, automatic logging, habits, streaks.
   No DOM access. Everything is derived from three things: block definitions,
   explicit marks (skipped / done early / manual habit overrides) and the clock. */
(function (g) {
  'use strict';

  var DAY_START = 0;     // 00:00
  var DAY_END = 1440;    // 24:00. A block never crosses midnight.

  /* Starting tags. Tags live in state.tags (id, name, one colour); everything else is derived from the colour. */
  var TAGS = [
    { id: 'work',     name: 'Work',     color: '#0A84FF' },
    { id: 'study',    name: 'Study',    color: '#BF5AF2' },
    { id: 'gym',      name: 'Gym',      color: '#30D158' },
    { id: 'german',   name: 'German',   color: '#FF9F0A' },
    { id: 'jobs',     name: 'Jobs',     color: '#FF375F' },
    { id: 'personal', name: 'Personal', color: '#8E8E93' }
  ];
  var PALETTE = ['#FF453A', '#FF9F0A', '#FFD60A', '#A4E34F', '#30D158', '#63E6E2', '#40C8E0', '#64D2FF',
                 '#0A84FF', '#5E5CE6', '#BF5AF2', '#FF2D92', '#FF375F', '#AC8E68', '#8E8E93'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function dk(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return dk(d); }
  function wd(s) { return (parse(s).getDay() + 6) % 7; }            // Monday = 0
  function weekStart(s) { return addDays(s, -wd(s)); }
  function isoWeek(s) {
    var d = parse(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    var w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  }
  function fmtMin(m) { return m === 1440 ? '24:00' : pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
  function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
  function endAt(date, endMin) { var d = parse(date); d.setHours(0, endMin, 0, 0); return d; }

  /* ---------- colours ---------- */

  /* '#abc', 'abc', '#AABBCC' -> '#AABBCC'; anything else -> null */
  function normHex(v) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v == null ? '' : v).trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    return '#' + h.toUpperCase();
  }
  function rgbOf(c) { var n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {        // t = share of b, 0..1
    var x = rgbOf(a), y = rgbOf(b);
    return '#' + [0, 1, 2].map(function (i) { return pad(Math.round(x[i] + (y[i] - x[i]) * t).toString(16)).toUpperCase(); }).join('');
  }
  function lum(c) {
    var v = rgbOf(c).map(function (u) { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /* Colour of a check mark drawn on a disc of this colour: white unless the disc is too light for it. */
  function habitChk(color) { return contrast('#FFFFFF', color) >= 3 ? '#FFFFFF' : '#111111'; }
  /* Everything a tile needs, from the one colour the user picked. Text on the tile fill always has 4.5:1 contrast. */
  function derive(tag) {
    var fill = mix(tag.color, '#000000', 0.72), t = 0.65, text = mix(tag.color, '#FFFFFF', t);
    while (contrast(text, fill) < 4.5 && t < 1) { t = Math.min(1, t + 0.05); text = mix(tag.color, '#FFFFFF', t); }
    return { id: tag.id, name: tag.name, color: tag.color, box: tag.color, fill: fill, text: text, chk: habitChk(tag.color) };
  }
  function tagList(state) { return state.tags.map(derive); }
  /* Unknown or deleted ids fall back to Personal, else the last tag. */
  function tagById(state, id) {
    var list = state.tags, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return derive(list[i]);
    for (i = 0; i < list.length; i++) if (list[i].id === 'personal') return derive(list[i]);
    return derive(list.length ? list[list.length - 1] : TAGS[TAGS.length - 1]);
  }

  function newState() {
    return {
      v: 1,
      habits: [
        { id: 'h-gym', name: 'Gym', color: '#30D158' },
        { id: 'h-study', name: 'Study', color: '#BF5AF2' },
        { id: 'h-german', name: 'German', color: '#FF9F0A' },
        { id: 'h-jobs', name: 'Applied to 5 jobs', color: '#FF375F' },
        { id: 'h-sleep', name: 'Sleep before 23:00', color: '#8E8E93' }
      ],
      tags: TAGS.map(function (t) { return { id: t.id, name: t.name, color: t.color }; }),
      tagHabit: { gym: 'h-gym', study: 'h-study', german: 'h-german', jobs: 'h-jobs' },
      blocks: [],
      marks: {},
      hiddenTags: []
    };
  }

  /* ---------- occurrences ---------- */

  function occurs(b, D) {
    if (b.rep === 'once') return b.date === D;
    if (D < b.startDate) return false;
    if (b.endDate && D > b.endDate) return false;
    if (b.days.indexOf(wd(D)) < 0) return false;
    if (b.ex && b.ex.indexOf(D) >= 0) return false;
    return true;
  }

  function occurrencesOn(state, D) {
    var out = [];
    state.blocks.forEach(function (b) {
      if (occurs(b, D)) {
        out.push({
          key: D + '|' + b.id, id: b.id, date: D, title: b.title, tag: b.tag,
          start: b.start, end: b.end, habit: b.habit || null, notes: b.notes || '',
          rep: b.rep, days: b.days || null
        });
      }
    });
    out.sort(function (a, b) { return a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : 1); });
    return out;
  }

  function findOcc(state, key) {
    var i = key.indexOf('|');
    var D = key.slice(0, i), id = key.slice(i + 1);
    var occs = occurrencesOn(state, D);
    for (var k = 0; k < occs.length; k++) if (occs[k].id === id) return occs[k];
    return null;
  }

  /* Side-by-side layout for overlapping blocks. Mutates and returns the array. */
  function layoutDay(occs) {
    var sorted = occs.slice().sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    var cluster = [], clusterEnd = -1;
    function flush() {
      var cols = 0;
      cluster.forEach(function (o) { if (o.col + 1 > cols) cols = o.col + 1; });
      cluster.forEach(function (o) { o.cols = cols; });
      cluster = []; clusterEnd = -1;
    }
    var colEnds = [];
    sorted.forEach(function (o) {
      if (cluster.length && o.start >= clusterEnd) { flush(); colEnds = []; }
      var c = 0;
      while (c < colEnds.length && colEnds[c] > o.start) c++;
      colEnds[c] = o.end;
      o.col = c;
      cluster.push(o);
      if (o.end > clusterEnd) clusterEnd = o.end;
    });
    if (cluster.length) flush();
    return sorted;
  }

  /* ---------- marks, status ---------- */

  function bKey(date, id) { return 'b|' + date + '|' + id; }
  function hKey(habit, date) { return 'h|' + habit + '|' + date; }

  function occStatus(state, occ, now) {
    var m = state.marks[bKey(occ.date, occ.id)];
    if (m) return m;                                   // 'd' done early / 'x' skipped
    if (occ.habit) { var ho = state.marks[hKey(occ.habit, occ.date)]; if (ho) return ho; }   // tracker click
    return endAt(occ.date, occ.end) <= now ? 'd' : 'p';  // blocks log themselves when they end
  }

  /* Click on a block's box: flips what is currently shown. */
  function toggleOcc(state, occ, now) {
    var cur = occStatus(state, occ, now);
    var ended = endAt(occ.date, occ.end) <= now;
    delete state.marks[bKey(occ.date, occ.id)];
    if (occ.habit) delete state.marks[hKey(occ.habit, occ.date)];   // keep tracker and block in agreement
    if (ended) { if (cur !== 'x') state.marks[bKey(occ.date, occ.id)] = 'x'; }
    else { if (cur !== 'd') state.marks[bKey(occ.date, occ.id)] = 'd'; }
  }

  /* ---------- habits ---------- */

  function habitDay(state, H, D, now) {
    var ov = state.marks[hKey(H, D)];
    if (ov === 'd') return 'done';
    if (ov === 'x') return 'missed';
    var occs = occurrencesOn(state, D).filter(function (o) { return o.habit === H; });
    if (!occs.length) return 'none';
    var sts = occs.map(function (o) { return occStatus(state, o, now); });
    if (sts.indexOf('d') >= 0) return 'done';
    if (sts.indexOf('x') >= 0) return 'missed';
    return D > dk(now) ? 'upcoming' : 'open';
  }

  function toggleHabit(state, H, D, now) {
    if (D > dk(now)) return false;
    var cur = habitDay(state, H, D, now);
    occurrencesOn(state, D).forEach(function (o) { if (o.habit === H) delete state.marks[bKey(D, o.id)]; });
    state.marks[hKey(H, D)] = cur === 'done' ? 'x' : 'd';
    return true;
  }

  function earliest(state, today) {
    var e = today;
    state.blocks.forEach(function (b) {
      var s = b.rep === 'once' ? b.date : b.startDate;
      if (s < e) e = s;
    });
    Object.keys(state.marks).forEach(function (k) {
      var p = k.split('|');
      var d = p[0] === 'b' ? p[1] : p[2];
      if (d && d < e) e = d;
    });
    return e;
  }

  /* Consecutive completed days, counting back from today. Days with no block planned
     for the habit are skipped, a missed day ends the streak. */
  function streak(state, H, now) {
    var today = dk(now), first = earliest(state, today), d = today, n = 0, guard = 0;
    while (d >= first && guard++ < 1200) {
      var s = habitDay(state, H, d, now);
      if (s === 'done') n++;
      else if (s === 'missed') break;
      d = addDays(d, -1);
    }
    return n;
  }

  function monthStats(state, H, y, m, now) {
    var today = dk(now), done = 0, missed = 0;
    var days = new Date(y, m + 1, 0).getDate();
    for (var i = 1; i <= days; i++) {
      var D = y + '-' + pad(m + 1) + '-' + pad(i);
      if (D > today) break;
      var s = habitDay(state, H, D, now);
      if (s === 'done') done++; else if (s === 'missed') missed++;
    }
    return { done: done, missed: missed, planned: done + missed };
  }

  /* Counts for one habit over the days from..to (inclusive). planned = days with a linked block or a manual mark,
     future days included. upcoming = planned days that are not decided yet (days still to come, and today until the
     block ends). So planned is always done + missed + upcoming. */
  function rangeStats(state, H, from, to, now) {
    var r = { done: 0, missed: 0, upcoming: 0, planned: 0 };
    for (var d = from; d <= to; d = addDays(d, 1)) {
      var s = habitDay(state, H, d, now);
      if (s === 'done') r.done++;
      else if (s === 'missed') r.missed++;
      else if (s === 'open' || s === 'upcoming') r.upcoming++;
    }
    r.planned = r.done + r.missed + r.upcoming;
    return r;
  }

  /* The week (Monday to Sunday) that contains weekStartDate. */
  function weekStats(state, H, weekStartDate, now) {
    var ws = weekStart(weekStartDate);
    return rangeStats(state, H, ws, addDays(ws, 6), now);
  }

  /* Longest run of done days inside one month, up to today. Same rules as streak(): days with nothing planned
     are skipped, a missed day ends the run. */
  function longestRun(state, H, y, m, now) {
    var today = dk(now), days = new Date(y, m + 1, 0).getDate(), run = 0, best = 0;
    for (var i = 1; i <= days; i++) {
      var D = y + '-' + pad(m + 1) + '-' + pad(i);
      if (D > today) break;
      var s = habitDay(state, H, D, now);
      if (s === 'done') { run++; if (run > best) best = run; }
      else if (s === 'missed') run = 0;
    }
    return best;
  }

  /* Everything the monthly progress card shows. m is 0-11.
     done / missed / planned count habit-days that are decided (up to today), summed over all habits; pct = done / planned.
     weeks: one row per Monday-Sunday week that touches the month, clipped to the month, with the same
     done / missed / upcoming / planned numbers as weekStats (planned includes days still to come).
     habits: per habit done / missed / planned for the month so far.
     bestStreak: the longest running streak right now. longestStreak: the longest run inside this month. */
  function monthSummary(state, y, m, now) {
    var first = y + '-' + pad(m + 1) + '-01', last = dk(new Date(y, m + 1, 0));
    var out = { year: y, month: m, done: 0, missed: 0, planned: 0, pct: null, weeks: [], habits: [],
                bestStreak: { count: 0, id: null, name: '' }, longestStreak: { count: 0, id: null, name: '' } };
    state.habits.forEach(function (h) {
      var st = monthStats(state, h.id, y, m, now), cur = streak(state, h.id, now), run = longestRun(state, h.id, y, m, now);
      out.habits.push({ id: h.id, name: h.name, color: h.color, done: st.done, missed: st.missed, planned: st.planned });
      out.done += st.done; out.missed += st.missed;
      if (cur > out.bestStreak.count) out.bestStreak = { count: cur, id: h.id, name: h.name };
      if (run > out.longestStreak.count) out.longestStreak = { count: run, id: h.id, name: h.name };
    });
    out.planned = out.done + out.missed;
    out.pct = out.planned ? Math.round(out.done / out.planned * 100) : null;
    for (var ws = weekStart(first); ws <= last; ws = addDays(ws, 7)) {
      var from = ws < first ? first : ws, to = addDays(ws, 6) > last ? last : addDays(ws, 6);
      var w = { week: isoWeek(ws), start: from, end: to, done: 0, missed: 0, upcoming: 0, planned: 0 };
      state.habits.forEach(function (h) {
        var r = rangeStats(state, h.id, from, to, now);
        w.done += r.done; w.missed += r.missed; w.upcoming += r.upcoming; w.planned += r.planned;
      });
      out.weeks.push(w);
    }
    return out;
  }

  /* ---------- editing ---------- */

  function rekeyMarks(state, fn) {
    var next = {};
    Object.keys(state.marks).forEach(function (k) {
      var nk = fn(k);
      if (nk) next[nk] = state.marks[k];
    });
    state.marks = next;
  }

  function clean(state, e) {
    var title = String(e.title || '').trim();
    var start = +e.start, end = +e.end;
    if (!title) return { error: 'Give the block a title.' };
    if (!(start >= DAY_START && start < DAY_END) || !(end > DAY_START && end <= DAY_END)) return { error: 'Times must be between 00:00 and 24:00.' };
    if (end <= start) return { error: 'End must be after start.' };
    return {
      title: title, start: start, end: end,
      tag: tagById(state, e.tag).id, habit: e.habit || null, notes: String(e.notes || '').trim()
    };
  }

  function daysFor(e) { return e.repeat === 'weekdays' ? [0, 1, 2, 3, 4] : [wd(e.date)]; }

  /* e: { id|null, occDate, date, title, tag, start, end, habit, notes, repeat: once|weekly|weekdays } */
  function saveBlock(state, e) {
    var c = clean(state, e);
    if (c.error) return c;
    var b = e.id ? state.blocks.filter(function (x) { return x.id === e.id; })[0] : null;

    if (!b) {
      var nb = { id: uid(), title: c.title, tag: c.tag, start: c.start, end: c.end, habit: c.habit, notes: c.notes };
      if (e.repeat === 'once') { nb.rep = 'once'; nb.date = e.date; }
      else { nb.rep = 'weekly'; nb.startDate = e.date; nb.endDate = null; nb.days = daysFor(e); nb.ex = []; }
      state.blocks.push(nb);
      return { ok: true, id: nb.id };
    }

    function apply(t) { t.title = c.title; t.tag = c.tag; t.start = c.start; t.end = c.end; t.habit = c.habit; t.notes = c.notes; }

    if (b.rep === 'once') {
      var old = b.date;
      apply(b);
      if (e.repeat === 'once') { b.date = e.date; }
      else { b.rep = 'weekly'; b.startDate = e.date; b.endDate = null; b.days = daysFor(e); b.ex = []; delete b.date; }
      if (old !== e.date) rekeyMarks(state, function (k) {
        return k === bKey(old, b.id) ? bKey(e.date, b.id) : k;
      });
      return { ok: true, id: b.id };
    }

    // series
    var D = e.occDate;
    if (e.repeat === 'once') {
      // change only this day: take it out of the series and make a one-off
      if (b.ex.indexOf(D) < 0) b.ex.push(D);
      var one = { id: uid(), rep: 'once', date: e.date };
      apply(one);
      state.blocks.push(one);
      rekeyMarks(state, function (k) { return k === bKey(D, b.id) ? bKey(e.date, one.id) : k; });
      return { ok: true, id: one.id };
    }
    var days = daysFor({ repeat: e.repeat, date: D });
    if (D <= b.startDate) {
      apply(b); b.days = days;
      return { ok: true, id: b.id };
    }
    // this and following: close the old series the day before, start a new one
    var nbk = { id: uid(), rep: 'weekly', startDate: D, endDate: b.endDate || null, days: days,
                ex: (b.ex || []).filter(function (x) { return x >= D; }) };
    apply(nbk);
    b.endDate = addDays(D, -1);
    b.ex = (b.ex || []).filter(function (x) { return x < D; });
    state.blocks.push(nbk);
    rekeyMarks(state, function (k) {
      var p = k.split('|');
      if (p[0] === 'b' && p[2] === b.id && p[1] >= D) return bKey(p[1], nbk.id);
      return k;
    });
    return { ok: true, id: nbk.id };
  }

  /* scope: 'one' (only this day) or 'following' (this day and everything after) */
  function deleteBlock(state, id, D, scope) {
    var b = state.blocks.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    function drop() { state.blocks = state.blocks.filter(function (x) { return x.id !== id; }); }
    if (b.rep === 'once') {
      drop();
      rekeyMarks(state, function (k) { return k === bKey(b.date, id) ? null : k; });
      return;
    }
    if (scope === 'one') {
      if (b.ex.indexOf(D) < 0) b.ex.push(D);
      rekeyMarks(state, function (k) { return k === bKey(D, id) ? null : k; });
      return;
    }
    if (D <= b.startDate) {
      drop();
      rekeyMarks(state, function (k) { var p = k.split('|'); return (p[0] === 'b' && p[2] === id) ? null : k; });
      return;
    }
    b.endDate = addDays(D, -1);
    b.ex = (b.ex || []).filter(function (x) { return x < D; });
    rekeyMarks(state, function (k) { var p = k.split('|'); return (p[0] === 'b' && p[2] === id && p[1] >= D) ? null : k; });
  }

  function deleteHabit(state, H) {
    state.habits = state.habits.filter(function (h) { return h.id !== H; });
    state.blocks.forEach(function (b) { if (b.habit === H) b.habit = null; });
    Object.keys(state.tagHabit).forEach(function (t) { if (state.tagHabit[t] === H) delete state.tagHabit[t]; });
    rekeyMarks(state, function (k) { var p = k.split('|'); return (p[0] === 'h' && p[1] === H) ? null : k; });
  }

  /* ---------- drag, copy ---------- */

  /* New times for a block dragged by deltaMin minutes. mode: 'move' | 'top' | 'bottom' (which edge is dragged).
     Snaps to 15 minutes, stays inside the day, never shorter than 15 minutes. */
  function dragTimes(start, end, mode, deltaMin) {
    var d = Math.round(deltaMin / 15) * 15, len = end - start, s, e;
    if (mode === 'top') { s = Math.min(Math.max(start + d, DAY_START), end - 15); return { start: s, end: end }; }
    if (mode === 'bottom') { e = Math.min(Math.max(end + d, start + 15), DAY_END); return { start: start, end: e }; }
    s = Math.min(Math.max(start + d, DAY_START), DAY_END - len);
    return { start: s, end: s + len };
  }

  /* Change the times of one day's block (key from occurrencesOn). A repeating block changes on that day only;
     its other days stay as they were. Done and skipped marks of the day move with it. */
  function retimeBlock(state, key, start, end) {
    var o = findOcc(state, key);
    if (!o) return { error: 'That block no longer exists.' };
    if (o.start === start && o.end === end) return { ok: true, same: true };
    var r = saveBlock(state, { id: o.id, occDate: o.date, date: o.date, title: o.title, tag: o.tag, start: start, end: end,
                               habit: o.habit, notes: o.notes, repeat: 'once' });
    if (r.ok) r.series = o.rep === 'weekly';
    return r;
  }

  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && dk(parse(s)) === s; }

  /* Copy a block's fields (title, tag, start, end, habit, notes) to another day as a one-off. Marks are not copied. */
  function copyBlock(state, f, toDate, fromDate) {
    if (!validDate(toDate)) return { error: 'Pick a date.' };
    if (toDate === fromDate) return { error: 'Pick a different day.' };
    return saveBlock(state, { id: null, date: toDate, title: f.title, tag: f.tag, start: f.start, end: f.end, habit: f.habit, notes: f.notes, repeat: 'once' });
  }

  /* ---------- tags ---------- */

  function tagName(v) { return String(v == null ? '' : v).trim().slice(0, 24); }

  function addTag(state, name, color) {
    var n = tagName(name), c = normHex(color);
    if (!n) return { error: 'Give the tag a name.' };
    if (!c) return { error: 'Use a hex colour like #0A84FF.' };
    var id = 't-' + uid();
    state.tags.push({ id: id, name: n, color: c });
    return { ok: true, id: id };
  }

  /* patch: { name?, color? } */
  function updateTag(state, id, patch) {
    var t = state.tags.filter(function (x) { return x.id === id; })[0];
    if (!t) return { error: 'No such tag.' };
    if ('name' in patch) { var n = tagName(patch.name); if (!n) return { error: 'Give the tag a name.' }; t.name = n; }
    if ('color' in patch) { var c = normHex(patch.color); if (!c) return { error: 'Use a hex colour like #0A84FF.' }; t.color = c; }
    return { ok: true };
  }

  /* Blocks that used the tag move to Personal (or the last tag left). At least one tag always stays. */
  function deleteTag(state, id) {
    if (!state.tags.some(function (t) { return t.id === id; })) return { error: 'No such tag.' };
    if (state.tags.length < 2) return { error: 'Keep at least one tag.' };
    state.tags = state.tags.filter(function (t) { return t.id !== id; });
    var to = tagById(state, 'personal').id;
    state.blocks.forEach(function (b) { if (b.tag === id) b.tag = to; });
    state.hiddenTags = state.hiddenTags.filter(function (t) { return t !== id; });
    delete state.tagHabit[id];
    return { ok: true, movedTo: to };
  }

  function normTags(raw) {
    var seen = {}, out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (t) {
      if (!t || !t.id || seen[t.id]) return;
      seen[t.id] = 1;
      out.push({ id: String(t.id), name: tagName(t.name) || 'Tag', color: normHex(t.color) || '#8E8E93' });
    });
    return out.length ? out : TAGS.map(function (t) { return { id: t.id, name: t.name, color: t.color }; });
  }

  /* ---------- import / export ---------- */

  function normalize(raw) {
    var s = raw && raw.state ? raw.state : raw;
    if (!s || typeof s !== 'object' || !Array.isArray(s.blocks) || !Array.isArray(s.habits)) return null;
    var out = newState();
    out.tags = normTags(s.tags);
    out.habits = s.habits.filter(function (h) { return h && h.id && h.name; })
      .map(function (h) { return { id: String(h.id), name: String(h.name), color: String(h.color || '#5F6877') }; });
    var known = {}; out.tags.forEach(function (t) { known[t.id] = 1; });
    out.tagHabit = {};
    Object.keys(s.tagHabit || {}).forEach(function (t) { if (known[t]) out.tagHabit[t] = s.tagHabit[t]; });
    out.hiddenTags = Array.isArray(s.hiddenTags) ? s.hiddenTags.filter(function (t) { return known[t]; }) : [];
    out.marks = {};
    Object.keys(s.marks || {}).forEach(function (k) { if (s.marks[k] === 'd' || s.marks[k] === 'x') out.marks[k] = s.marks[k]; });
    out.blocks = s.blocks.filter(function (b) { return b && b.id && (b.rep === 'once' || b.rep === 'weekly'); })
      .map(function (b) {
        // Blocks saved before the 24-hour day could run past midnight (up to 01:00). Cut them at 24:00.
        var end = Math.min(+b.end, DAY_END), start = Math.max(+b.start, DAY_START);
        if (start >= end) start = Math.max(DAY_START, end - 15);
        var o = { id: String(b.id), title: String(b.title || 'Untitled'), tag: tagById(out, b.tag).id,
                  start: start, end: end, habit: b.habit || null, notes: String(b.notes || ''), rep: b.rep };
        if (b.rep === 'once') o.date = String(b.date);
        else { o.startDate = String(b.startDate); o.endDate = b.endDate || null; o.days = (b.days || []).map(Number); o.ex = (b.ex || []).slice(); }
        return o;
      });
    return out;
  }

  g.PlannerLogic = {
    DAY_START: DAY_START, DAY_END: DAY_END, TAGS: TAGS, PALETTE: PALETTE,
    pad: pad, dk: dk, parse: parse, addDays: addDays, wd: wd, weekStart: weekStart, isoWeek: isoWeek, fmtMin: fmtMin, endAt: endAt,
    tagById: tagById, tagList: tagList, habitChk: habitChk, normHex: normHex, contrast: contrast,
    addTag: addTag, updateTag: updateTag, deleteTag: deleteTag, dragTimes: dragTimes, retimeBlock: retimeBlock, copyBlock: copyBlock, validDate: validDate,
    newState: newState, occurrencesOn: occurrencesOn, findOcc: findOcc, layoutDay: layoutDay,
    occStatus: occStatus, toggleOcc: toggleOcc, habitDay: habitDay, toggleHabit: toggleHabit,
    streak: streak, monthStats: monthStats, rangeStats: rangeStats, weekStats: weekStats, monthSummary: monthSummary, saveBlock: saveBlock, deleteBlock: deleteBlock,
    deleteHabit: deleteHabit, normalize: normalize, earliest: earliest
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
