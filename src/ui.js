/* Planner UI: rendering, events, storage. */
(function () {
  'use strict';
  var L = window.PlannerLogic;
  var $app = document.getElementById('app'), $dlg = document.getElementById('dlg');

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var HOUR_PX = 52;

  var S = L.newState();
  var now = new Date();
  var view = 'day';
  var sel = L.dk(now);
  var cal = { y: now.getFullYear(), m: now.getMonth() };
  var hv = { y: now.getFullYear(), m: now.getMonth() };
  var quick = null, dlg = null, hdlg = null, ddlg = null;
  var lastTag = 'personal';
  var ready = false;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ic(name, size) {
    var p = { check: 'M2.5 7.5l3 3 6-7', x: 'M3.5 3.5l7 7M10.5 3.5l-7 7', plus: 'M7 2.5v9M2.5 7h9', l: 'M9 2.5L4.5 7 9 11.5', r: 'M5 2.5L9.5 7 5 11.5' }[name];
    var sw = name === 'check' || name === 'x' ? 2.2 : 1.8;
    return '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + p + '"/></svg>';
  }
  function isoWeek(s) {
    var d = L.parse(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    var w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  }
  function longDate(s) { var d = L.parse(s); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function shortDate(s) { var d = L.parse(s); return DAYS[L.wd(s)].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3); }
  function habitById(id) { for (var i = 0; i < S.habits.length; i++) if (S.habits[i].id === id) return S.habits[i]; return null; }
  function tagVars(t) { return '--b:' + t.box + ';--f:' + t.fill + ';--t:' + t.text; }

  /* ================= storage ================= */
  var Store = (function () {
    var LS = 'planner.v1', mode = 'local', db = null, uidp = '', last = {}, known = {}, timer = null, writing = false, again = false;
    var dirty = false, status = 'loading', note = '';

    function lsRead() { try { var t = localStorage.getItem(LS); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
    function lsWrite() { try { localStorage.setItem(LS, JSON.stringify({ app: 'planner', v: 1, state: S })); return true; } catch (e) { return false; } }
    function setStatus(s) { status = s; var n = document.getElementById('sync'); if (n) n.textContent = label(); }
    function label() {
      return { loading: 'Loading', saving: 'Saving', saved: 'Saved', local: 'Saved on this device', error: 'Not saved, retrying', blocked: 'Not saved, use Export' }[status] || '';
    }
    function toDocs(st) {
      var years = {};
      Object.keys(st.marks).forEach(function (k) {
        var p = k.split('|'), d = p[0] === 'b' ? p[1] : p[2], y = d.slice(0, 4);
        (years[y] = years[y] || {})[k] = st.marks[k];
      });
      return { core: { v: 1, habits: st.habits, tagHabit: st.tagHabit, blocks: st.blocks, hiddenTags: st.hiddenTags, years: Object.keys(years).sort() }, years: years };
    }
    function prime(st) {
      var d = toDocs(st); last = {}; known = {};
      last[uidp + '/core'] = JSON.stringify(d.core);
      Object.keys(d.years).forEach(function (y) { known[y] = 1; last[uidp + '/marks-' + y] = JSON.stringify({ m: d.years[y] }); });
    }
    function timeout(ms) { return new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); }); }

    async function cloudRead() {
      var snap = await db.doc(uidp + '/core').get();
      if (!snap.exists) return null;
      var c = snap.data() || {}, marks = {}, ys = c.years || [];
      for (var i = 0; i < ys.length; i++) {
        var s2 = await db.doc(uidp + '/marks-' + ys[i]).get();
        if (s2.exists) { var m = (s2.data() || {}).m || {}; Object.keys(m).forEach(function (k) { marks[k] = m[k]; }); }
      }
      return L.normalize({ habits: c.habits, tagHabit: c.tagHabit, blocks: c.blocks, hiddenTags: c.hiddenTags, marks: marks });
    }
    async function cloudInit() {
      db = await window.claude.use('db');
      var user = await window.claude.use('user');
      var id = user && (await user.id());
      if (!id) throw new Error('signed out');
      uidp = 'data/users/' + id;
      return cloudRead();
    }

    async function init() {
      var st = null;
      if (window.claude && typeof window.claude.use === 'function') {
        try {
          st = await Promise.race([cloudInit(), timeout(10000)]);
          mode = 'cloud';
          if (!st) { var legacy = lsRead(); st = legacy ? L.normalize(legacy) : null; if (st) dirty = true; }
          if (st) prime(st); else { st = L.newState(); prime(L.newState()); dirty = true; }
        } catch (e) {
          mode = 'local'; db = null;
          note = 'Cloud sync is unavailable right now, so changes are kept on this device only.';
          st = null;
        }
      }
      if (!st) { var raw = lsRead(); st = (raw && L.normalize(raw)) || L.newState(); }
      S = st;
      setStatus(mode === 'cloud' ? 'saved' : 'local');
      if (dirty) schedule();
    }

    function schedule() {
      dirty = true; setStatus('saving');
      clearTimeout(timer); timer = setTimeout(flush, 500);
    }

    async function cloudWrite() {
      var d = toDocs(S), writes = [[uidp + '/core', d.core]];
      Object.keys(d.years).forEach(function (y) { writes.push([uidp + '/marks-' + y, { m: d.years[y] }]); });
      Object.keys(known).forEach(function (y) { if (!d.years[y]) writes.push([uidp + '/marks-' + y, { m: {} }]); });
      for (var i = 0; i < writes.length; i++) {
        var json = JSON.stringify(writes[i][1]);
        if (last[writes[i][0]] === json) continue;
        await db.doc(writes[i][0]).set(JSON.parse(json));
        last[writes[i][0]] = json;
      }
      known = {}; Object.keys(d.years).forEach(function (y) { known[y] = 1; });
    }

    async function flush() {
      if (writing) { again = true; return; }
      writing = true;
      try {
        do {
          again = false;
          var ok = lsWrite();
          if (mode === 'cloud') await cloudWrite();
          setStatus(mode === 'cloud' ? 'saved' : (ok ? 'local' : 'blocked'));
        } while (again);
        dirty = false;
      } catch (e) {
        setStatus('error'); clearTimeout(timer); timer = setTimeout(flush, 5000);
      } finally { writing = false; }
    }

    async function refresh() {
      if (mode !== 'cloud' || dirty || writing) return null;
      try {
        var st = await cloudRead();
        if (!st || dirty || writing) return null;
        if (JSON.stringify(st) === JSON.stringify(S)) return null;
        prime(st); return st;
      } catch (e) { return null; }
    }

    async function download(name, text) {
      if (window.claude && typeof window.claude.use === 'function') {
        try { var d = await window.claude.use('downloads'); await d.save({ filename: name, data: text }); return 'Export saved.'; }
        catch (e) { return (e && e.code === 'declined') ? 'Export cancelled.' : 'Export is not available in this view. Open the planner in its own tab and try again.'; }
      }
      try {
        var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
        return 'Export saved.';
      } catch (e) { return 'Export failed.'; }
    }

    return {
      init: init, schedule: schedule, refresh: refresh, download: download, label: label,
      get note() { return note; }, get mode() { return mode; }, get dirty() { return dirty; },
      flushNow: function () { clearTimeout(timer); if (dirty) flush(); }
    };
  })();

  /* ================= rendering ================= */

  function render() {
    now = new Date();
    var html = renderTop() + '<div class="body">' + (view === 'day' ? '<aside class="side">' + renderCal() + renderTags() + renderHabitSide() + '</aside>' : '') + '<main class="main">' +
      (view === 'day' ? renderDay() : renderHabits()) + '</main></div>';
    $app.innerHTML = html;
    if (quick) {
      var q = $app.querySelector('.qin');
      if (q && quick.focus) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { } }
    }
  }

  function renderTop() {
    var nav = view === 'day'
      ? '<div class="dnav"><button class="btn" data-a="today">Today</button><button class="ib" data-a="prev" aria-label="Previous day">' + ic('l', 16) + '</button><button class="ib" data-a="next" aria-label="Next day">' + ic('r', 16) + '</button><span class="ttl">' + esc(DAYS[L.wd(sel)] + ', ' + longDate(sel)) + '</span></div>'
      : '<div class="dnav"><button class="btn" data-a="today">This month</button><button class="ib" data-a="prev" aria-label="Previous month">' + ic('l', 16) + '</button><button class="ib" data-a="next" aria-label="Next month">' + ic('r', 16) + '</button><span class="ttl">' + MONTHS[hv.m] + ' ' + hv.y + '</span></div>';
    return '<header class="top"><div class="brand"><span class="logo"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="13" height="12" rx="2.5"/><path d="M2.5 7.5h13M6 2v3M12 2v3"/></svg></span>Planner</div>' +
      '<div class="seg" role="group" aria-label="View"><button data-a="view" data-v="day" class="' + (view === 'day' ? 'on' : '') + '" aria-pressed="' + (view === 'day') + '">Day</button><button data-a="view" data-v="habits" class="' + (view === 'habits' ? 'on' : '') + '" aria-pressed="' + (view === 'habits') + '">Habits</button></div>' +
      nav + '<span class="grow"></span><span class="sync" id="sync" role="status">' + esc(Store.label()) + '</span>' +
      '<button class="btn" data-a="data-open">Data</button>' +
      (view === 'day' ? '<button class="btn pri" data-a="new">' + ic('plus', 14) + ' New block</button>' : '<button class="btn" data-a="hm-open">Edit habits</button>') + '</header>';
  }

  function renderCal() {
    var first = cal.y + '-' + L.pad(cal.m + 1) + '-01', off = L.wd(first), dim = new Date(cal.y, cal.m + 1, 0).getDate();
    var rows = Math.ceil((off + dim) / 7), start = L.addDays(first, -off), selWeek = L.weekStart(sel), today = L.dk(now), h = '';
    for (var i = 0; i < rows * 7; i++) {
      var D = L.addDays(start, i), w = L.wd(D), d = L.parse(D);
      var c = 'cd' + (L.weekStart(D) === selWeek ? ' band' : '') + (w === 0 ? ' l' : '') + (w === 6 ? ' r' : '') + (d.getMonth() !== cal.m ? ' out' : '') +
        (D === today ? ' today' : '') + (D === sel ? ' sel' : '') + (L.occurrencesOn(S, D).length ? ' has' : '');
      h += '<button class="' + c + '" data-a="pick" data-d="' + D + '" aria-label="' + esc(longDate(D)) + '"' + (D === sel ? ' aria-current="date"' : '') + '><span class="cc"><span class="n">' + d.getDate() + '</span><i></i></span></button>';
    }
    return '<section class="card pad" aria-label="Calendar"><div class="calh"><span class="h3">' + MONTHS[cal.m] + ' ' + cal.y + '</span><span><button class="ib s" data-a="cal-prev" aria-label="Previous month">' + ic('l') + '</button><button class="ib s" data-a="cal-next" aria-label="Next month">' + ic('r') + '</button></span></div>' +
      '<div class="dow"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div><div class="cgrid">' + h + '</div></section>';
  }

  function renderTags() {
    return '<section class="card pad" aria-label="Tags"><div class="h3" style="margin-bottom:4px">Tags</div>' + L.TAGS.map(function (t) {
      var off = S.hiddenTags.indexOf(t.id) >= 0;
      return '<button class="trow" data-a="tag" data-t="' + t.id + '" aria-pressed="' + (!off) + '"><span class="tbox' + (off ? ' off' : '') + '" style="--b:' + t.box + '">' + (off ? '' : ic('check', 11)) + '</span><span>' + t.name + '</span></button>';
    }).join('') + '</section>';
  }

  function stateLabel(s) { return { done: 'done', missed: 'not done', open: 'open', upcoming: 'upcoming', none: 'not planned' }[s]; }

  function renderHabitSide() {
    var today = L.dk(now), future = sel > today, done = 0, planned = 0;
    var rows = S.habits.map(function (h) {
      var s = L.habitDay(S, h.id, sel, now);
      if (s !== 'none') planned++;
      if (s === 'done') done++;
      return '<button class="hside" data-a="hab" data-h="' + h.id + '" data-d="' + sel + '"' + (future ? ' disabled' : '') + ' aria-label="' + esc(h.name + ', ' + stateLabel(s)) + '"><span class="hbox ' + (s === 'done' ? 'done' : (s === 'none' || s === 'upcoming') ? 'none' : '') + '" style="--c:' + h.color + '">' + (s === 'done' ? ic('check', 13) : s === 'missed' ? ic('x', 12) : '') + '</span><span class="hn">' + esc(h.name) + '</span></button>';
    }).join('');
    var title = sel === today ? 'Today’s habits' : 'Habits, ' + shortDate(sel);
    return '<section class="card pad" aria-label="Habits for the day"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="h3">' + esc(title) + '</span><span class="small muted">' + (planned ? done + ' of ' + planned : 'none planned') + '</span></div><div style="margin-top:6px">' + (rows || '<div class="note">No habits yet.</div>') + '</div>' +
      '<div class="small muted" style="margin-top:8px">Logged automatically when a block ends. Click a box if you did not do it.</div></section>';
  }

  function visibleOccs(D) {
    return L.occurrencesOn(S, D).filter(function (o) { return S.hiddenTags.indexOf(o.tag) < 0; });
  }

  function renderDay() {
    var occs = visibleOccs(sel), doneN = 0, i;
    var statuses = occs.map(function (o) { var s = L.occStatus(S, o, now); if (s === 'd') doneN++; return s; });
    var pct = occs.length ? Math.round(doneN / occs.length * 100) : 0;
    var rows = '';
    for (i = 8; i <= 24; i++) {
      var lab = L.fmtMin(i * 60);
      rows += '<button class="hr" data-a="slot" data-m="' + i * 60 + '" aria-label="Add a block at ' + lab + '"><span class="hrl">' + lab + '</span><span class="hrc"><span class="ghost">' + ic('plus', 14) + ' Add at ' + lab + '</span></span></button>';
    }
    var laid = L.layoutDay(occs.map(function (o, k) { o._s = statuses[k]; return o; }));
    var tiles = laid.map(function (o) {
      var t = L.tagById(o.tag), top = (o.start - 480) * HOUR_PX / 60 + 2, hgt = (o.end - o.start) * HOUR_PX / 60 - 4;
      var short = o.end - o.start <= 60, s = o._s, hb = o.habit ? habitById(o.habit) : null, pill = '';
      if (hb) pill = s === 'd' ? '<span class="pill on">' + ic('check', 11) + ' Logged to ' + esc(hb.name) + '</span>' : s === 'x' ? '<span class="pill off">Not logged</span>' : '<span class="pill dash">Auto-logs to ' + esc(hb.name) + '</span>';
      var pw = 100 / o.cols, lf = o.col * pw;
      var key = o.key;
      return '<div class="tile' + (short ? ' short' : '') + (s === 'x' ? ' skip' : '') + '" style="top:' + top + 'px;height:' + hgt + 'px;left:calc(' + lf + '% + 4px);width:calc(' + pw + '% - 8px);background:' + t.fill + ';color:' + t.text + ';--c:' + t.box + '">' +
        '<button class="chk' + (s === 'd' ? ' on' : s === 'x' ? ' off' : '') + '" data-a="occ" data-k="' + esc(key) + '" aria-pressed="' + (s === 'd') + '" aria-label="' + esc(o.title + ': ' + (s === 'd' ? 'done. Click if you did not do it' : s === 'x' ? 'not done. Click to mark done' : 'planned. Click to mark done')) + '">' + (s === 'd' ? ic('check', 13) : s === 'x' ? ic('x', 12) : '') + '</button>' +
        '<button class="tbody" data-a="open" data-k="' + esc(key) + '" aria-label="Edit ' + esc(o.title) + '"><span class="tt">' + esc(o.title) + '</span><span class="tm">' + L.fmtMin(o.start) + ' – ' + L.fmtMin(o.end) + ' · ' + t.name + '</span></button>' + pill + '</div>';
    }).join('');

    var q = '';
    if (quick) {
      var qt = (quick.start - 480) * HOUR_PX / 60 + 2, maxTop = 17 * HOUR_PX - 150;
      if (qt > maxTop) qt = maxTop;
      q = '<div class="quick" style="top:' + qt + 'px" role="group" aria-label="New block"><input class="qin" data-f="q-title" value="' + esc(quick.title) + '" placeholder="What are you doing?" aria-label="Title" autocomplete="off"><div class="chips">' +
        L.TAGS.map(function (t) { return '<button class="chip' + (quick.tag === t.id ? ' on' : '') + '" style="' + tagVars(t) + '" data-a="q-tag" data-t="' + t.id + '" aria-pressed="' + (quick.tag === t.id) + '"><i></i>' + t.name + '</button>'; }).join('') +
        '</div><div class="qrow"><span>' + timeSelect('q-start', quick.start, 'start') + ' – ' + timeSelect('q-end', quick.end, 'end') + '</span><span class="hint">Enter to add · Esc to cancel</span><span><button class="btn sm" data-a="q-more">Details</button> <button class="btn sm pri" data-a="q-add">Add</button></span></div></div>';
    }

    var nl = '', mins = Math.round((now - L.parse(sel)) / 60000);
    if (mins >= 480 && mins <= 1500) nl = '<div class="nowl" style="top:' + ((mins - 480) * HOUR_PX / 60) + 'px"><b>' + L.fmtMin(mins) + '</b><s></s><u></u></div>';

    return '<div class="card"><div class="dayh"><div><div class="d1">' + DAYS[L.wd(sel)] + '</div><div class="muted">' + longDate(sel) + ' · Week ' + isoWeek(sel) + '</div></div>' +
      '<div class="prog"><span>' + doneN + ' of ' + occs.length + ' blocks done</span><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></div></div>' +
      '<div class="grid">' + rows + '<div class="ov">' + tiles + q + '</div>' + nl + '</div></div>';
  }

  function timeSelect(f, val, kind, cls) {
    var o = '', from = kind === 'start' ? 480 : 495, to = kind === 'start' ? 1485 : 1500, seen = false, m;
    for (m = from; m <= to; m += 15) { if (m === val) seen = true; o += '<option value="' + m + '"' + (m === val ? ' selected' : '') + '>' + L.fmtMin(m) + '</option>'; }
    if (!seen) o = '<option value="' + val + '" selected>' + L.fmtMin(val) + '</option>' + o;
    return '<select class="' + (cls || 'qtime') + '" data-f="' + f + '" aria-label="' + (kind === 'start' ? 'Start' : 'End') + '">' + o + '</select>';
  }

  function renderHabits() {
    var y = hv.y, mo = hv.m, n = new Date(y, mo + 1, 0).getDate(), today = L.dk(now), d, i;
    var cards = S.habits.map(function (h) {
      var st = L.monthStats(S, h.id, y, mo, now), sk = L.streak(S, h.id, now), pct = st.planned ? Math.round(st.done / st.planned * 100) : 0;
      return '<div class="card sc" style="--c:' + h.color + '"><div class="nm"><span class="sw"></span>' + esc(h.name) + '</div><div class="big"><b>' + sk + '</b><span class="muted">in a row</span></div><div class="bar"><i style="width:' + pct + '%"></i></div><div class="small muted">' + (st.planned ? st.done + ' of ' + st.planned + ' planned days this month' : 'Nothing planned yet this month') + '</div></div>';
    }).join('');
    var head = '<div class="hrow hd" style="--n:' + n + '"><span></span>';
    for (i = 1; i <= n; i++) {
      d = y + '-' + L.pad(mo + 1) + '-' + L.pad(i);
      head += '<div class="hdc' + (d === today ? ' t' : '') + '">' + 'MTWTFSS'.charAt(L.wd(d)) + '<span>' + i + '</span></div>';
    }
    head += '<span class="small muted" style="text-align:center">Done</span></div>';
    var body = S.habits.map(function (h) {
      var cells = '', st = L.monthStats(S, h.id, y, mo, now);
      for (i = 1; i <= n; i++) {
        d = y + '-' + L.pad(mo + 1) + '-' + L.pad(i);
        var s = L.habitDay(S, h.id, d, now), fut = d > today;
        cells += '<span class="hcw' + (d === today ? ' t' : '') + '"><button class="hc ' + s + '" style="--c:' + h.color + '" data-a="hab" data-h="' + h.id + '" data-d="' + d + '"' + (fut ? ' disabled' : '') + ' aria-label="' + esc(h.name + ', ' + shortDate(d) + ': ' + stateLabel(s)) + '">' + (s === 'done' ? ic('check', 14) : s === 'missed' ? '<span style="color:#6B7482">' + ic('x', 12) + '</span>' : s === 'upcoming' ? '<i></i>' : '') + '</button></span>';
      }
      return '<div class="hrow b" style="--n:' + n + '"><span class="hl"><span class="sw" style="--c:' + h.color + '"></span><span class="hn">' + esc(h.name) + '</span></span>' + cells + '<span class="tot">' + st.done + '/' + st.planned + '</span></div>';
    }).join('');
    return '<div class="hv"><div class="cards">' + cards + '</div><div class="card pad tw"><div class="tin">' + head + body + '</div></div>' +
      '<div class="legend"><span><span class="lg" style="background:#1B8A4F">' + ic('check', 12) + '</span>Done, logged automatically</span><span><span class="lg" style="background:#F4F5F8;border:1px solid #E3E6EB;color:#6B7482">' + ic('x', 10) + '</span>Not done, you marked it</span><span><span class="lg" style="border:1.5px dashed #3F51D6"></span>Open today</span><span class="muted">Click any past box to flip it.</span></div></div>';
  }

  /* ---------- dialogs ---------- */

  function renderDlg() {
    if (dlg) { $dlg.innerHTML = blockDlg(); return; }
    if (hdlg) { $dlg.innerHTML = habitDlg(); return; }
    if (ddlg) { $dlg.innerHTML = dataDlg(); return; }
    $dlg.innerHTML = '';
  }
  function closeDlg() { dlg = null; hdlg = null; ddlg = null; $dlg.innerHTML = ''; }
  function openDlg(focusSel) {
    renderDlg();
    var f = $dlg.querySelector(focusSel || 'input,select,button'); if (f) f.focus();
  }

  function blockDlg() {
    var d = dlg, hb = d.habit ? habitById(d.habit) : null, wdName = DAYS[L.wd(d.series ? d.occDate : d.date)];
    var dateLocked = d.series && d.repeat !== 'once';
    var chips = L.TAGS.map(function (t) { return '<button class="chip lg' + (d.tag === t.id ? ' on' : '') + '" style="' + tagVars(t) + '" data-a="d-tag" data-t="' + t.id + '" aria-pressed="' + (d.tag === t.id) + '"><i></i>' + t.name + '</button>'; }).join('');
    var reps = [['once', 'Only this day'], ['weekly', 'Every ' + wdName], ['weekdays', 'Every weekday']].map(function (r) { return '<button data-a="d-rep" data-r="' + r[0] + '" aria-pressed="' + (d.repeat === r[0]) + '">' + r[1] + '</button>'; }).join('');
    var sel2 = d.habit ? '<select class="fld" style="margin-top:8px" data-f="d-habit" aria-label="Habit">' + S.habits.map(function (h) { return '<option value="' + h.id + '"' + (h.id === d.habit ? ' selected' : '') + '>' + esc(h.name) + '</option>'; }).join('') + '</select>' : '';
    var foot;
    if (d.confirm) {
      foot = d.series
        ? '<div class="conf"><span>Delete this repeating block?</span><span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-a="d-del-cancel">Keep it</button><button class="btn sm danger" data-a="d-del-one">Only this day</button><button class="btn sm danger" data-a="d-del-follow">This and following</button></span></div>'
        : '<div class="conf"><span>Delete this block?</span><span style="display:flex;gap:8px"><button class="btn sm" data-a="d-del-cancel">Keep it</button><button class="btn sm danger" data-a="d-del-one">Delete</button></span></div>';
    } else {
      foot = '<div class="df"><span>' + (d.id ? '<button class="btn danger" data-a="d-del">Delete block</button>' : '') + '</span><span style="display:flex;gap:8px"><button class="btn" data-a="d-cancel">Cancel</button><button class="btn pri" data-a="d-save">Save</button></span></div>';
    }
    return '<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dt"><div class="dh"><h2 id="dt">' + (d.id ? 'Edit block' : 'New block') + '</h2><button class="ib" data-a="d-cancel" aria-label="Close">' + ic('x', 16) + '</button></div>' +
      '<label class="lbl first" for="f-title">Title</label><input id="f-title" class="fld" data-f="title" value="' + esc(d.title) + '" autocomplete="off">' +
      '<div class="g3"><div><label class="lbl" for="f-date">Date</label><input id="f-date" type="date" class="fld" data-f="date" value="' + d.date + '"' + (dateLocked ? ' disabled' : '') + '></div>' +
      '<div><label class="lbl" for="f-start">Start</label>' + timeSelect('d-start', d.start, 'start', 'fld').replace('<select', '<select id="f-start"') + '</div>' +
      '<div><label class="lbl" for="f-end">End</label>' + timeSelect('d-end', d.end, 'end', 'fld').replace('<select', '<select id="f-end"') + '</div></div>' +
      '<span class="lbl">Tag</span><div class="chips">' + chips + '</div>' +
      '<div class="hbar"><div><div style="font-weight:600">' + (hb ? 'Count toward the ' + esc(hb.name) + ' habit' : 'Count toward a habit') + '</div><div class="note">Logged automatically when the block ends. Click its box on the day view if you did not do it.</div></div><button class="sw2" role="switch" aria-checked="' + !!d.habit + '" aria-label="Count toward a habit" data-a="d-habit"><i></i></button></div>' + sel2 +
      '<span class="lbl">Repeat</span><div class="segc" role="group" aria-label="Repeat">' + reps + '</div>' +
      (d.series ? '<div class="small muted" style="margin-top:6px">Changes to a repeating block apply to this day and the days after it. Earlier days stay as they were.</div>' : '') +
      '<label class="lbl" for="f-notes">Notes</label><textarea id="f-notes" class="fld" data-f="notes" placeholder="Optional">' + esc(d.notes) + '</textarea>' +
      (d.err ? '<div class="err" role="alert">' + esc(d.err) + '</div>' : '') + foot + '</div></div>';
  }

  function habitDlg() {
    var rows = S.habits.map(function (h) {
      return '<div class="hli"><input class="fld" data-f="hname" data-h="' + h.id + '" value="' + esc(h.name) + '" aria-label="Habit name"><span class="cdots" role="group" aria-label="Colour">' +
        L.HABIT_COLORS.map(function (c) { return '<button class="cdot" style="--c:' + c + '" data-a="hm-color" data-h="' + h.id + '" data-c="' + c + '" aria-pressed="' + (h.color === c) + '" aria-label="Colour ' + c + '"></button>'; }).join('') +
        '</span><button class="btn sm danger" data-a="hm-del" data-h="' + h.id + '">' + (hdlg.confirm === h.id ? 'Confirm remove' : 'Remove') + '</button></div>';
    }).join('');
    return '<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dt"><div class="dh"><h2 id="dt">Habits</h2><button class="ib" data-a="hm-close" aria-label="Close">' + ic('x', 16) + '</button></div>' +
      '<div class="note" style="margin-bottom:12px">A block counts toward a habit when you pick it in the block’s editor. Removing a habit also removes its history.</div><div class="hlist">' + rows + '</div>' +
      '<div class="df"><button class="btn" data-a="hm-add">' + ic('plus', 14) + ' Add habit</button><button class="btn pri" data-a="hm-close">Done</button></div></div></div>';
  }

  function dataDlg() {
    var d = ddlg, where = Store.mode === 'cloud' ? 'Your planner is saved to your Claude account and opens on any device you sign in on.' : 'Your planner is saved in this browser on this device.';
    var pend = d.pending ? '<div class="conf"><span>Replace the current planner with the file (' + d.pending.blocks.length + ' blocks, ' + d.pending.habits.length + ' habits)?</span><span style="display:flex;gap:8px"><button class="btn sm" data-a="import-cancel">Cancel</button><button class="btn sm danger" data-a="import-ok">Replace</button></span></div>' : '';
    var rst = d.reset ? '<div class="conf"><span>Delete every block and all history?</span><span style="display:flex;gap:8px"><button class="btn sm" data-a="reset-cancel">Cancel</button><button class="btn sm danger" data-a="reset-ok">Delete everything</button></span></div>' : '';
    return '<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dt"><div class="dh"><h2 id="dt">Data</h2><button class="ib" data-a="data-close" aria-label="Close">' + ic('x', 16) + '</button></div>' +
      '<div class="note">' + esc(where) + (Store.note ? ' ' + esc(Store.note) : '') + '</div>' +
      '<div class="drow"><span><b>Export</b><div class="note">Download a backup file of everything.</div></span><button class="btn" data-a="export">Export</button></div>' +
      '<div class="drow"><span><b>Import</b><div class="note">Load a backup file. This replaces what is here.</div></span><button class="btn" data-a="import-pick">Choose file</button><input type="file" id="imp" accept=".json,application/json" class="sr" tabindex="-1" aria-hidden="true"></div>' + pend +
      '<div class="drow"><span><b>Start over</b><div class="note">Delete all blocks and history.</div></span><button class="btn danger" data-a="reset">Reset</button></div>' + rst +
      (d.msg ? '<div class="note" role="status" style="margin-top:8px">' + esc(d.msg) + '</div>' : '') +
      '<div class="df"><span></span><button class="btn pri" data-a="data-close">Done</button></div></div></div>';
  }

  /* ================= actions ================= */

  function commit() { Store.schedule(); render(); }
  function syncCal() { var d = L.parse(sel); cal = { y: d.getFullYear(), m: d.getMonth() }; }
  function defaultStart() {
    var m = Math.floor((now - L.parse(sel)) / 60000);
    if (sel === L.dk(now) && m >= 480 && m < 1440) return Math.min(Math.ceil((m + 1) / 60) * 60, 1440);
    return 540;
  }

  function openEdit(key) {
    var o = L.findOcc(S, key); if (!o) return;
    var weekdays = o.days && o.days.length === 5 && o.days.indexOf(5) < 0 && o.days.indexOf(6) < 0;
    quick = null;
    dlg = { id: o.id, occDate: o.date, date: o.date, title: o.title, tag: o.tag, start: o.start, end: o.end, habit: o.habit, notes: o.notes,
      repeat: o.rep === 'once' ? 'once' : (weekdays ? 'weekdays' : 'weekly'), series: o.rep === 'weekly', err: '', confirm: false };
    render(); openDlg('[data-f=title]');
  }
  function openNew(init) {
    var s = init && init.start != null ? init.start : defaultStart(), e = init && init.end != null ? init.end : Math.min(s + 60, 1500);
    var tag = (init && init.tag) || 'personal';
    dlg = { id: null, occDate: null, date: sel, title: (init && init.title) || '', tag: tag, start: s, end: e, habit: S.tagHabit[tag] || null, notes: '', repeat: 'once', series: false, err: '', confirm: false };
    quick = null; render(); openDlg('[data-f=title]');
  }

  var actions = {
    view: function (el) { view = el.dataset.v; quick = null; render(); },
    today: function () { now = new Date(); sel = L.dk(now); syncCal(); hv = { y: now.getFullYear(), m: now.getMonth() }; quick = null; render(); },
    prev: function () { if (view === 'day') { sel = L.addDays(sel, -1); syncCal(); quick = null; } else { hv.m--; if (hv.m < 0) { hv.m = 11; hv.y--; } } render(); },
    next: function () { if (view === 'day') { sel = L.addDays(sel, 1); syncCal(); quick = null; } else { hv.m++; if (hv.m > 11) { hv.m = 0; hv.y++; } } render(); },
    'cal-prev': function () { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } render(); },
    'cal-next': function () { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } render(); },
    pick: function (el) { sel = el.dataset.d; syncCal(); quick = null; if (view !== 'day') view = 'day'; render(); },
    tag: function (el) {
      var t = el.dataset.t, i = S.hiddenTags.indexOf(t);
      if (i >= 0) S.hiddenTags.splice(i, 1); else S.hiddenTags.push(t);
      commit();
    },
    hab: function (el) { now = new Date(); if (L.toggleHabit(S, el.dataset.h, el.dataset.d, now)) commit(); },
    occ: function (el) { now = new Date(); var o = L.findOcc(S, el.dataset.k); if (o) { L.toggleOcc(S, o, now); commit(); } },
    open: function (el) { openEdit(el.dataset.k); },
    slot: function (el) {
      var s = +el.dataset.m; if (s >= 1500) s = 1440;
      quick = { start: s, end: Math.min(s + 60, 1500), tag: lastTag, title: '', focus: true }; render();
    },
    new: function () { openNew(); },
    'q-tag': function (el) { quick.tag = el.dataset.t; quick.focus = true; render(); },
    'q-cancel': function () { quick = null; render(); },
    'q-more': function () { var q = quick; openNew({ start: q.start, end: q.end, tag: q.tag, title: q.title }); },
    'q-add': function () { quickAdd(); },

    'd-cancel': function () { closeDlg(); },
    'd-tag': function (el) {
      var old = dlg.habit === (S.tagHabit[dlg.tag] || null);
      dlg.tag = el.dataset.t; if (old) dlg.habit = S.tagHabit[dlg.tag] || null; renderDlg();
    },
    'd-habit': function () {
      dlg.habit = dlg.habit ? null : (S.tagHabit[dlg.tag] || (S.habits[0] && S.habits[0].id) || null); renderDlg();
    },
    'd-rep': function (el) { dlg.repeat = el.dataset.r; renderDlg(); },
    'd-save': function () {
      var d = dlg;
      var r = L.saveBlock(S, { id: d.id, occDate: d.occDate, date: d.date, title: d.title, tag: d.tag, start: d.start, end: d.end, habit: d.habit, notes: d.notes, repeat: d.repeat });
      if (r.error) { d.err = r.error; renderDlg(); return; }
      var hi = S.hiddenTags.indexOf(d.tag); if (hi >= 0) S.hiddenTags.splice(hi, 1);
      lastTag = d.tag; sel = d.date; syncCal(); closeDlg(); commit();
    },
    'd-del': function () { dlg.confirm = true; renderDlg(); },
    'd-del-cancel': function () { dlg.confirm = false; renderDlg(); },
    'd-del-one': function () { L.deleteBlock(S, dlg.id, dlg.occDate, 'one'); closeDlg(); commit(); },
    'd-del-follow': function () { L.deleteBlock(S, dlg.id, dlg.occDate, 'following'); closeDlg(); commit(); },

    'hm-open': function () { hdlg = { confirm: null }; openDlg('input'); },
    'hm-close': function () { closeDlg(); commit(); },
    'hm-add': function () {
      var c = L.HABIT_COLORS[S.habits.length % L.HABIT_COLORS.length];
      S.habits.push({ id: 'h-' + Math.random().toString(36).slice(2, 8), name: 'New habit', color: c });
      Store.schedule(); renderDlg();
      var ins = $dlg.querySelectorAll('input'); if (ins.length) { var l = ins[ins.length - 1]; l.focus(); l.select(); }
    },
    'hm-color': function (el) { var h = habitById(el.dataset.h); if (h) { h.color = el.dataset.c; Store.schedule(); renderDlg(); } },
    'hm-del': function (el) {
      if (hdlg.confirm === el.dataset.h) { L.deleteHabit(S, el.dataset.h); hdlg.confirm = null; Store.schedule(); }
      else hdlg.confirm = el.dataset.h;
      renderDlg();
    },

    'data-open': function () { ddlg = { msg: '', pending: null, reset: false }; openDlg('button'); },
    'data-close': function () { closeDlg(); render(); },
    export: function () {
      var name = 'planner-' + L.dk(new Date()) + '.json';
      Store.download(name, JSON.stringify({ app: 'planner', v: 1, exported: new Date().toISOString(), state: S }, null, 1)).then(function (m) { if (ddlg) { ddlg.msg = m; renderDlg(); } });
    },
    'import-pick': function () { var f = document.getElementById('imp'); if (f) f.click(); },
    'import-cancel': function () { ddlg.pending = null; renderDlg(); },
    'import-ok': function () { S = ddlg.pending; ddlg.pending = null; ddlg.msg = 'Imported.'; Store.schedule(); renderDlg(); },
    reset: function () { ddlg.reset = true; renderDlg(); },
    'reset-cancel': function () { ddlg.reset = false; renderDlg(); },
    'reset-ok': function () { S = L.newState(); ddlg.reset = false; ddlg.msg = 'Everything was cleared.'; Store.schedule(); renderDlg(); }
  };

  function quickAdd() {
    var q = quick, title = q.title.trim();
    if (!title) { q.focus = true; render(); return; }
    var r = L.saveBlock(S, { id: null, date: sel, title: title, tag: q.tag, start: q.start, end: q.end, habit: S.tagHabit[q.tag] || null, notes: '', repeat: 'once' });
    if (r.error) { return; }
    var hi = S.hiddenTags.indexOf(q.tag); if (hi >= 0) S.hiddenTags.splice(hi, 1);
    lastTag = q.tag; quick = null; commit();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    var fn = actions[el.dataset.a];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('input', function (e) {
    var f = e.target.dataset && e.target.dataset.f; if (!f) return;
    var v = e.target.value;
    if (f === 'q-title' && quick) quick.title = v;
    else if (f === 'title' && dlg) dlg.title = v;
    else if (f === 'notes' && dlg) dlg.notes = v;
    else if (f === 'hname') { var h = habitById(e.target.dataset.h); if (h) { h.name = v.trim() ? v : h.name; Store.schedule(); } }
  });

  document.addEventListener('change', function (e) {
    var f = e.target.dataset && e.target.dataset.f, v = e.target.value;
    if (e.target.id === 'imp') { importFile(e.target.files && e.target.files[0]); return; }
    if (!f) return;
    if (f === 'q-start' && quick) { quick.start = +v; if (quick.end <= quick.start) quick.end = Math.min(quick.start + 60, 1500); quick.focus = false; render(); }
    else if (f === 'q-end' && quick) { quick.end = +v; if (quick.end <= quick.start) quick.start = Math.max(quick.end - 60, 480); quick.focus = false; render(); }
    else if (f === 'd-start' && dlg) { dlg.start = +v; if (dlg.end <= dlg.start) dlg.end = Math.min(dlg.start + 60, 1500); renderDlg(); }
    else if (f === 'd-end' && dlg) { dlg.end = +v; if (dlg.end <= dlg.start) dlg.start = Math.max(dlg.end - 60, 480); renderDlg(); }
    else if (f === 'date' && dlg) { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { dlg.date = v; renderDlg(); } }
    else if (f === 'd-habit' && dlg) { dlg.habit = v; renderDlg(); }
    else if (f === 'hname') { render(); }
  });

  function importFile(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      var st = null;
      try { st = L.normalize(JSON.parse(String(r.result))); } catch (e) { st = null; }
      if (!ddlg) return;
      if (!st) { ddlg.msg = 'That file is not a planner backup.'; ddlg.pending = null; }
      else { ddlg.pending = st; ddlg.msg = ''; }
      renderDlg();
    };
    r.onerror = function () { if (ddlg) { ddlg.msg = 'Could not read that file.'; renderDlg(); } };
    r.readAsText(file);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (dlg || hdlg || ddlg) { var wasH = !!hdlg; closeDlg(); if (wasH) commit(); else render(); }
      else if (quick) { quick = null; render(); }
    } else if (e.key === 'Enter' && quick && e.target.classList && e.target.classList.contains('qin')) {
      e.preventDefault(); quickAdd();
    } else if (e.key === 'Enter' && dlg && e.target.dataset && e.target.dataset.f === 'title') {
      e.preventDefault(); actions['d-save']();
    }
  });

  /* ================= boot ================= */

  setInterval(function () {
    if (!ready || dlg || hdlg || ddlg || quick) return;
    render();
  }, 30000);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { Store.flushNow(); return; }
    if (!ready) return;
    Store.refresh().then(function (st) {
      if (st && !dlg && !hdlg && !ddlg && !quick) { S = st; render(); } else if (!st && !dlg && !hdlg && !ddlg && !quick) render();
    });
  });
  window.addEventListener('pagehide', function () { Store.flushNow(); });

  Store.init().then(function () {
    ready = true; render();
    var n = document.querySelector('.nowl');
    if (n && view === 'day') { try { window.scrollTo(0, Math.max(0, n.getBoundingClientRect().top + window.scrollY - 220)); } catch (e) { } }
  });

  window.__planner = { get S() { return S; }, Store: Store };
})();
