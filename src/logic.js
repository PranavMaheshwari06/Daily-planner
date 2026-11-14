/* Planner logic: dates, recurrence, automatic logging, habits, streaks.
   No DOM access. Everything is derived from three things: block definitions,
   explicit marks (skipped / done early / manual habit overrides) and the clock. */
(function (g) {
  'use strict';

  var DAY_START = 480;   // 08:00
  var DAY_END = 1500;    // 01:00 the next morning

  var TAGS = [
    { id: 'work',     name: 'Work',     fill: '#0F2A4D', text: '#A9D0FF', box: '#0A84FF', chk: '#FFFFFF' },
    { id: 'study',    name: 'Study',    fill: '#2B1840', text: '#E2BCFA', box: '#BF5AF2', chk: '#FFFFFF' },
    { id: 'gym',      name: 'Gym',      fill: '#0F3320', text: '#8FE8AC', box: '#30D158', chk: '#06240F' },
    { id: 'german',   name: 'German',   fill: '#3A2506', text: '#FFC978', box: '#FF9F0A', chk: '#2B1900' },
    { id: 'jobs',     name: 'Jobs',     fill: '#3F0F1A', text: '#FFA3B5', box: '#FF375F', chk: '#FFFFFF' },
    { id: 'personal', name: 'Personal', fill: '#242427', text: '#D1D1D6', box: '#8E8E93', chk: '#111111' }
  ];
  var HABIT_COLORS = TAGS.map(function (t) { return t.box; });

  function pad(n) { return String(n).padStart(2, '0'); }
  function dk(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return dk(d); }
  function wd(s) { return (parse(s).getDay() + 6) % 7; }            // Monday = 0
  function weekStart(s) { return addDays(s, -wd(s)); }
  function fmtMin(m) { return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
  function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
  function endAt(date, endMin) { var d = parse(date); d.setHours(0, endMin, 0, 0); return d; }
  function tagById(id) { for (var i = 0; i < TAGS.length; i++) if (TAGS[i].id === id) return TAGS[i]; return TAGS[TAGS.length - 1]; }
  function habitChk(color) { for (var i = 0; i < TAGS.length; i++) if (TAGS[i].box === color) return TAGS[i].chk; return '#FFFFFF'; }

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

  /* ---------- editing ---------- */

  function rekeyMarks(state, fn) {
    var next = {};
    Object.keys(state.marks).forEach(function (k) {
      var nk = fn(k);
      if (nk) next[nk] = state.marks[k];
    });
    state.marks = next;
  }

  function clean(e) {
    var title = String(e.title || '').trim();
    var start = +e.start, end = +e.end;
    if (!title) return { error: 'Give the block a title.' };
    if (!(start >= DAY_START && start < DAY_END) || !(end > DAY_START && end <= DAY_END)) return { error: 'Times must be between 08:00 and 01:00.' };
    if (end <= start) return { error: 'End must be after start.' };
    return {
      title: title, start: start, end: end,
      tag: tagById(e.tag).id, habit: e.habit || null, notes: String(e.notes || '').trim()
    };
  }

  function daysFor(e) { return e.repeat === 'weekdays' ? [0, 1, 2, 3, 4] : [wd(e.date)]; }

  /* e: { id|null, occDate, date, title, tag, start, end, habit, notes, repeat: once|weekly|weekdays } */
  function saveBlock(state, e) {
    var c = clean(e);
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

  /* ---------- import / export ---------- */

  function normalize(raw) {
    var s = raw && raw.state ? raw.state : raw;
    if (!s || typeof s !== 'object' || !Array.isArray(s.blocks) || !Array.isArray(s.habits)) return null;
    var out = newState();
    out.habits = s.habits.filter(function (h) { return h && h.id && h.name; })
      .map(function (h) { return { id: String(h.id), name: String(h.name), color: String(h.color || '#5F6877') }; });
    out.tagHabit = {};
    Object.keys(s.tagHabit || {}).forEach(function (t) { out.tagHabit[t] = s.tagHabit[t]; });
    out.hiddenTags = Array.isArray(s.hiddenTags) ? s.hiddenTags.slice() : [];
    out.marks = {};
    Object.keys(s.marks || {}).forEach(function (k) { if (s.marks[k] === 'd' || s.marks[k] === 'x') out.marks[k] = s.marks[k]; });
    out.blocks = s.blocks.filter(function (b) { return b && b.id && (b.rep === 'once' || b.rep === 'weekly'); })
      .map(function (b) {
        var o = { id: String(b.id), title: String(b.title || 'Untitled'), tag: tagById(b.tag).id,
                  start: +b.start, end: +b.end, habit: b.habit || null, notes: String(b.notes || ''), rep: b.rep };
        if (b.rep === 'once') o.date = String(b.date);
        else { o.startDate = String(b.startDate); o.endDate = b.endDate || null; o.days = (b.days || []).map(Number); o.ex = (b.ex || []).slice(); }
        return o;
      });
    return out;
  }

  g.PlannerLogic = {
    DAY_START: DAY_START, DAY_END: DAY_END, TAGS: TAGS, HABIT_COLORS: HABIT_COLORS,
    pad: pad, dk: dk, parse: parse, addDays: addDays, wd: wd, weekStart: weekStart, fmtMin: fmtMin, endAt: endAt, tagById: tagById, habitChk: habitChk,
    newState: newState, occurrencesOn: occurrencesOn, findOcc: findOcc, layoutDay: layoutDay,
    occStatus: occStatus, toggleOcc: toggleOcc, habitDay: habitDay, toggleHabit: toggleHabit,
    streak: streak, monthStats: monthStats, saveBlock: saveBlock, deleteBlock: deleteBlock,
    deleteHabit: deleteHabit, normalize: normalize, earliest: earliest
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
