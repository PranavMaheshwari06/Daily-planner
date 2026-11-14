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
  var quick = null, dlg = null, hdlg = null, ddlg = null, tdlg = null;
  var lastTag = 'personal';
  var ready = false;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ic(name, size) {
    var p = { check: 'M2.5 7.5l3 3 6-7', x: 'M3.5 3.5l7 7M10.5 3.5l-7 7', plus: 'M7 2.5v9M2.5 7h9', l: 'M9 2.5L4.5 7 9 11.5', r: 'M5 2.5L9.5 7 5 11.5' }[name];
    var sw = name === 'check' || name === 'x' ? 2.2 : 1.8;
    return '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + p + '"/></svg>';
  }
  function longDate(s) { var d = L.parse(s); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function shortDate(s) { var d = L.parse(s); return DAYS[L.wd(s)].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3); }
  function anyDlg() { return dlg || hdlg || ddlg || tdlg; }
  function habitById(id) { for (var i = 0; i < S.habits.length; i++) if (S.habits[i].id === id) return S.habits[i]; return null; }
  function tagVars(t) { return '--b:' + t.box + ';--f:' + t.fill + ';--t:' + t.text; }

  /* ================= storage ================= */
  var Store = (function () {
    var LS = 'planner.v1', mode = 'local', db = null, uidp = '', last = {}, known = {}, timer = null, writing = false, again = false;
    var dirty = false, status = 'loading', note = '', cloudExpected = false, legacyDoc = false;
    var unsubs = [], liveTimer = null, liveYears = '', api = {};

    function stable(o) {
      if (o === null || typeof o !== 'object') return JSON.stringify(o);
      if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
      return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}';
    }

    function lsRead() { try { var t = localStorage.getItem(LS); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
    function lsWrite() { try { localStorage.setItem(LS, JSON.stringify({ app: 'planner', v: 1, state: S })); return true; } catch (e) { return false; } }
    function setStatus(s) { status = s; var n = document.getElementById('sync'); if (n) n.textContent = label(); }
    function label() {
      return { loading: 'Loading', saving: 'Saving', saved: 'Synced', local: 'On this device only', error: 'Not saved, retrying', blocked: 'Not saved, use Export' }[status] || '';
    }
    function toDocs(st) {
      var years = {};
      Object.keys(st.marks).forEach(function (k) {
        var p = k.split('|'), d = p[0] === 'b' ? p[1] : p[2], y = d.slice(0, 4);
        (years[y] = years[y] || {})[k] = st.marks[k];
      });
      return { core: { v: 1, habits: st.habits, tags: st.tags, tagHabit: st.tagHabit, blocks: st.blocks, hiddenTags: st.hiddenTags, years: Object.keys(years).sort() }, years: years };
    }
    function prime(st) {
      var d = toDocs(st); last = {}; known = {};
      last[uidp + '/core'] = stable(d.core);
      Object.keys(d.years).forEach(function (y) { known[y] = 1; last[uidp + '/marks-' + y] = stable({ m: d.years[y] }); });
    }
    function timeout(ms) { return new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); }); }

    async function cloudRead() {
      var snap = await db.doc(uidp + '/core').get();
      if (!snap.exists) return null;
      var c = snap.data() || {}, marks = {}, ys = c.years || [];
      legacyDoc = !Array.isArray(c.tags);
      for (var i = 0; i < ys.length; i++) {
        var s2 = await db.doc(uidp + '/marks-' + ys[i]).get();
        if (s2.exists) { var m = (s2.data() || {}).m || {}; Object.keys(m).forEach(function (k) { marks[k] = m[k]; }); }
      }
      return L.normalize({ habits: c.habits, tags: c.tags, tagHabit: c.tagHabit, blocks: c.blocks, hiddenTags: c.hiddenTags, marks: marks });
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
        cloudExpected = true;
        try {
          st = await Promise.race([cloudInit(), timeout(10000)]);
          mode = 'cloud';
          if (!st) { var legacy = lsRead(); st = legacy ? L.normalize(legacy) : null; if (st) dirty = true; }
          if (st) prime(st); else { st = L.newState(); prime(L.newState()); dirty = true; }
          if (legacyDoc) { delete last[uidp + '/core']; dirty = true; }   // saved before custom tags: write the tags back once
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
      if (mode === 'cloud') startLive();
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
        var json = stable(writes[i][1]);
        if (last[writes[i][0]] === json) continue;
        await db.doc(writes[i][0]).set(JSON.parse(JSON.stringify(writes[i][1])));
        last[writes[i][0]] = json;
      }
      known = {}; Object.keys(d.years).forEach(function (y) { known[y] = 1; });
      if (Object.keys(known).sort().join(',') !== liveYears) startLive();
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
        if (stable(toDocs(st)) === stable(toDocs(S))) return null;
        prime(st); return st;
      } catch (e) { return null; }
    }


    /* Live sync: listen to our docs; when someone else changes one, re-read and hand the new state to the UI. */
    function stopLive() { unsubs.forEach(function (u) { try { u(); } catch (e) { } }); unsubs = []; }
    function startLive() {
      stopLive();
      if (mode !== 'cloud' || !db) return;
      var paths = [uidp + '/core'].concat(Object.keys(known).sort().map(function (y) { return uidp + '/marks-' + y; }));
      liveYears = Object.keys(known).sort().join(',');
      paths.forEach(function (p) {
        try {
          var ref = db.doc(p);
          if (typeof ref.onSnapshot !== 'function') return;
          var u = ref.onSnapshot(function (snap) { onSnap(p, snap); }, function () { });
          if (typeof u === 'function') unsubs.push(u);
        } catch (e) { }
      });
    }
    function onSnap(p, snap) {
      var json = snap && snap.exists ? stable(snap.data() || {}) : null;
      if (json === null ? !(p in last) : last[p] === json) return;   // our own write, or nothing new
      clearTimeout(liveTimer); liveTimer = setTimeout(applyRemote, 350);
    }
    async function applyRemote() {
      if (dirty || writing) { liveTimer = setTimeout(applyRemote, 1200); return; }
      var st = await refresh();
      if (st && api.onRemote) api.onRemote(st);
      if (Object.keys(known).sort().join(',') !== liveYears) startLive();
    }

    async function download(name, text) {
      if (window.claude && typeof window.claude.use === 'function') {
        cloudExpected = true;
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

    api = {
      init: init, schedule: schedule, refresh: refresh, download: download, label: label, onRemote: null,
      get note() { return note; }, get mode() { return mode; }, get dirty() { return dirty; },
      get offlineBanner() { return cloudExpected && mode !== 'cloud'; },
      flushNow: function () { clearTimeout(timer); if (dirty) flush(); }
    };
    return api;
  })();

  /* ================= rendering ================= */

  var phone = false, calOpen = false, pendingRemote = null;
  function detectPhone() {
    try { if (window.matchMedia) return window.matchMedia('(max-width: 760px)').matches; } catch (e) { }
    return window.innerWidth <= 760;
  }
  function tagStyle(t) { return '--b:' + t.box + ';--f:' + t.fill + ';--t:' + t.text + ';--k:' + t.chk; }

  function render() {
    now = new Date(); phone = detectPhone();
    var banner = Store.offlineBanner ? '<div class="banner" role="alert"><b>Not syncing.</b> This page is not signed in to Claude, so changes stay on this device only. Open the link in Chrome while signed in to claude.ai.</div>' : '';
    $app.innerHTML = banner + (phone ? renderPhone() : renderDesk());
    if (quick) {
      var q = $app.querySelector('.qin');
      if (q && quick.focus) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { } }
    }
  }

  function renderDesk() {
    return renderTop() + '<div class="body">' + (view === 'day' ? '<aside class="side">' + renderCal() + renderTags() + renderHabitSide() + '</aside>' : '') + '<main class="main">' +
      (view === 'day' ? renderDay() : renderHabits()) + '</main></div>';
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

  /* ---------- phone ---------- */
  function dayStats() {
    var occs = visibleOccs(sel), done = 0;
    occs.forEach(function (o) { if (L.occStatus(S, o, now) === 'd') done++; });
    return { total: occs.length, done: done };
  }
  function ringSvg(done, total, size) {
    var r = (size - 6) / 2, C = 2 * Math.PI * r, off = total ? C * (1 - done / total) : C, c = size / 2;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="#2C2C2E" stroke-width="5"></circle><circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="#409CFF" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 ' + c + ' ' + c + ')" style="transition:stroke-dashoffset .5s cubic-bezier(.2,.8,.2,1)"></circle></svg>';
  }
  function renderPhone() {
    var today = L.dk(now), head, main, fab = '';
    if (view === 'day') {
      var st = dayStats(), d = L.parse(sel), ws = L.weekStart(sel), strip = '';
      for (var i = 0; i < 7; i++) {
        var D = L.addDays(ws, i), n = L.parse(D).getDate();
        strip += '<button class="wkd' + (D === sel ? ' sel' : '') + (D === today ? ' today' : '') + (L.occurrencesOn(S, D).length ? ' has' : '') + '" data-a="pick" data-d="' + D + '" aria-label="' + esc(longDate(D)) + '"' + (D === sel ? ' aria-current="date"' : '') + '><em>' + 'MTWTFSS'.charAt(i) + '</em><span>' + n + '<i></i></span></button>';
      }
      var tags = calOpen ? '<div class="phtags" role="group" aria-label="Tags">' + L.tagList(S).map(function (t) {
        var off = S.hiddenTags.indexOf(t.id) >= 0;
        return '<button class="chip' + (off ? '' : ' on') + '" style="' + tagStyle(t) + '" data-a="tag" data-t="' + t.id + '" aria-pressed="' + (!off) + '"><i></i>' + t.name + '</button>';
      }).join('') + '<button class="chip ed" data-a="tg-open">Edit tags</button></div>' : '';
      head = '<header class="ph"><div class="ph-top"><button class="mbtn' + (calOpen ? ' open' : '') + '" data-a="cal-toggle" aria-expanded="' + calOpen + '" aria-label="Month calendar">' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ic('chev', 18) + '</button>' +
        '<span style="display:flex;align-items:center;gap:12px"><span class="sync" id="sync" role="status">' + esc(Store.label()) + '</span>' + (sel !== today ? '<button class="mbtn" data-a="today">Today</button>' : '') + '</span></div>' +
        '<div class="ph-title"><div><div class="d1">' + DAYS[L.wd(sel)] + '</div><div class="d2">' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' · Week ' + L.isoWeek(sel) + '</div></div><div class="ringw">' + ringSvg(st.done, st.total, 44) + '<span>' + st.done + ' of ' + st.total + '</span></div></div>' +
        (calOpen ? '<div class="phcal">' + renderCal() + tags + '</div>' : '<div class="wkstrip">' + strip + '</div>') + '</header>';
      main = '<main class="pmain">' + gridHtml() + '</main>';
      fab = '<button class="fab" data-a="new" aria-label="New block">' + ic('plus', 26) + '</button>';
    } else {
      head = '<header class="ph"><div class="ph-top"><span style="display:flex;align-items:center;gap:4px"><button class="ib s" data-a="prev" aria-label="Previous month">' + ic('l') + '</button><span class="mbtn" style="cursor:default">' + MONTHS[hv.m] + ' ' + hv.y + '</span><button class="ib s" data-a="next" aria-label="Next month">' + ic('r') + '</button></span>' +
        '<span style="display:flex;align-items:center;gap:12px"><span class="sync" id="sync" role="status">' + esc(Store.label()) + '</span><button class="mbtn" data-a="hm-open">Edit</button></span></div>' +
        '<div class="ph-title"><div><div class="d1">Habits</div><div class="d2">This week. Done boxes log themselves; tap one to flip it.</div></div></div><div style="height:10px"></div></header>';
      main = '<main class="pmain"><div class="phabits">' + S.habits.map(habitCard).join('') + (S.habits.length ? '' : '<div class="note">No habits yet. Tap Edit to add one.</div>') + '</div></main>';
    }
    var tabs = [['day', 'Day', 'day'], ['habits', 'Habits', 'habit'], ['data', 'Data', 'data']].map(function (t) {
      var on = view === t[0];
      return t[0] === 'data' ? '<button data-a="data-open" aria-label="Data">' + tabIcon(t[2]) + 'Data</button>'
        : '<button class="' + (on ? 'on' : '') + '" data-a="view" data-v="' + t[0] + '" aria-pressed="' + on + '">' + tabIcon(t[2]) + t[1] + '</button>';
    }).join('');
    return head + main + fab + '<nav class="tabbar" aria-label="Main">' + tabs + '</nav>';
  }
  function tabIcon(n) {
    var p = { day: 'M3.5 5.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zM3.5 7.5h11M6.5 2.5v2M11.5 2.5v2', habit: 'M3.5 3.5h4.5v4.5H3.5zM10 3.5h4.5v4.5H10zM3.5 10H8v4.5H3.5zM11 12l1.5 1.5L15 10.5', data: 'M9 3c3 0 5.5.9 5.5 2s-2.5 2-5.5 2-5.5-.9-5.5-2S6 3 9 3zM3.5 5v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V5M3.5 9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2' }[n];
    return '<svg width="24" height="24" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + p + '"></path></svg>';
  }
  function habitCard(h) {
    var today = L.dk(now), ws = L.weekStart(today), st = L.monthStats(S, h.id, hv.y, hv.m, now), sk = L.streak(S, h.id, now), wk = L.weekStats(S, h.id, ws, now);
    var pct = st.planned ? Math.round(st.done / st.planned * 100) : 0, chk = L.habitChk(h.color), cells = '';
    for (var i = 0; i < 7; i++) {
      var D = L.addDays(ws, i), s = L.habitDay(S, h.id, D, now), fut = D > today;
      cells += '<button data-a="hab" data-h="' + h.id + '" data-d="' + D + '"' + (fut ? ' disabled' : '') + ' aria-label="' + esc(h.name + ', ' + shortDate(D) + ': ' + stateLabel(s)) + '"><em' + (D === today ? ' class="t"' : '') + '>' + 'MTWTFSS'.charAt(i) + '</em><small' + (D === today ? ' class="t"' : '') + '>' + L.parse(D).getDate() + '</small><span class="wc ' + s + '">' + (s === 'done' ? ic('check', 16) : s === 'missed' ? ic('x', 14) : s === 'upcoming' ? '<i></i>' : '') + '</span></button>';
    }
    return '<section class="hcard" style="--c:' + h.color + ';--k:' + chk + '" aria-label="' + esc(h.name) + '"><div class="r1"><div><div class="nm"><span class="sw"></span>' + esc(h.name) + '</div><div class="wkc">' + (wk.planned ? '<b>' + wk.done + '</b> of ' + wk.planned + ' this week' : 'Nothing planned this week') + '</div></div><div class="muted small"><b style="font-size:20px;color:#fff;letter-spacing:-.01em">' + sk + '</b> in a row</div></div><div class="wk">' + cells + '</div><div class="bar" style="margin-top:14px"><i style="width:' + pct + '%"></i></div><div class="small muted" style="margin-top:6px">' + (st.planned ? st.done + ' of ' + st.planned + ' planned days this month' : 'Nothing planned yet this month') + '</div></section>';
  }

  /* ---------- shared pieces ---------- */
  function renderCal() {
    var first = cal.y + '-' + L.pad(cal.m + 1) + '-01', off = L.wd(first), dim = new Date(cal.y, cal.m + 1, 0).getDate();
    var rows = Math.ceil((off + dim) / 7), start = L.addDays(first, -off), selWeek = L.weekStart(sel), today = L.dk(now), h = '';
    for (var i = 0; i < rows * 7; i++) {
      var D = L.addDays(start, i), w = L.wd(D), d = L.parse(D);
      var c = 'cd' + (L.weekStart(D) === selWeek ? ' band' : '') + (w === 0 ? ' l' : '') + (w === 6 ? ' r' : '') + (d.getMonth() !== cal.m ? ' out' : '') +
        (D === today ? ' today' : '') + (D === sel ? ' sel' : '') + (L.occurrencesOn(S, D).length ? ' has' : '');
      h += '<button class="' + c + '" data-a="pick" data-d="' + D + '" aria-label="' + esc(longDate(D)) + '"' + (D === sel ? ' aria-current="date"' : '') + '><span class="cc"><span class="n">' + d.getDate() + '</span><i></i></span></button>';
    }
    return '<section class="' + (phone ? '' : 'card pad') + '" aria-label="Calendar"><div class="calh"><span class="h3">' + MONTHS[cal.m] + ' ' + cal.y + '</span><span><button class="ib s" data-a="cal-prev" aria-label="Previous month">' + ic('l') + '</button><button class="ib s" data-a="cal-next" aria-label="Next month">' + ic('r') + '</button></span></div>' +
      '<div class="dow"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div><div class="cgrid">' + h + '</div></section>';
  }

  function renderTags() {
    return '<section class="card pad" aria-label="Tags"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span class="h3">Tags</span><button class="btn sm" data-a="tg-open">Edit</button></div>' + L.tagList(S).map(function (t) {
      var off = S.hiddenTags.indexOf(t.id) >= 0;
      return '<button class="trow" data-a="tag" data-t="' + t.id + '" aria-pressed="' + (!off) + '"><span class="tbox' + (off ? ' off' : '') + '" style="--b:' + t.box + ';--k:' + t.chk + '">' + (off ? '' : ic('check', 12)) + '</span><span>' + t.name + '</span></button>';
    }).join('') + '</section>';
  }

  function stateLabel(s) { return { done: 'done', missed: 'not done', open: 'open', upcoming: 'upcoming', none: 'not planned' }[s]; }

  function renderHabitSide() {
    var today = L.dk(now), future = sel > today, done = 0, planned = 0;
    var rows = S.habits.map(function (h) {
      var s = L.habitDay(S, h.id, sel, now);
      if (s !== 'none') planned++;
      if (s === 'done') done++;
      return '<button class="hside" data-a="hab" data-h="' + h.id + '" data-d="' + sel + '"' + (future ? ' disabled' : '') + ' aria-label="' + esc(h.name + ', ' + stateLabel(s)) + '"><span class="hbox ' + (s === 'done' ? 'done' : (s === 'none' || s === 'upcoming') ? 'none' : s === 'missed' ? 'missed' : '') + '" style="--c:' + h.color + ';--k:' + L.habitChk(h.color) + '">' + (s === 'done' ? ic('check', 13) : s === 'missed' ? ic('x', 12) : '') + '</span><span class="hn">' + esc(h.name) + '</span></button>';
    }).join('');
    var title = sel === today ? 'Today’s habits' : 'Habits, ' + shortDate(sel);
    return '<section class="card pad" aria-label="Habits for the day"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="h3">' + esc(title) + '</span><span class="small muted">' + (planned ? done + ' of ' + planned : 'none planned') + '</span></div><div style="margin-top:6px">' + (rows || '<div class="note">No habits yet.</div>') + '</div>' +
      '<div class="small muted" style="margin-top:8px">Logged automatically when a block ends. Click a circle if you did not do it.</div></section>';
  }

  function visibleOccs(D) {
    return L.occurrencesOn(S, D).filter(function (o) { return S.hiddenTags.indexOf(o.tag) < 0; });
  }

  function gridHtml() {
    var occs = visibleOccs(sel), i, rows = '';
    var statuses = occs.map(function (o) { return L.occStatus(S, o, now); });
    for (i = 0; i < 24; i++) {
      var lab = L.fmtMin(i * 60);
      var nm = Math.round((now - L.parse(sel)) / 60000), near = Math.abs(nm - i * 60) < 24;
      rows += '<button class="hr" data-a="slot" data-m="' + i * 60 + '" aria-label="Add a block at ' + lab + '"><span class="hrl">' + (near ? '' : lab) + '</span><span class="hrc"><span class="ghost">' + ic('plus', 14) + ' Add at ' + lab + '</span></span></button>';
    }
    var laid = L.layoutDay(occs.map(function (o, k) { o._s = statuses[k]; return o; }));
    var tiles = laid.map(function (o) {
      var t = L.tagById(S, o.tag), top = (o.start - L.DAY_START) * HOUR_PX / 60 + 2, hgt = (o.end - o.start) * HOUR_PX / 60 - 4;
      var short = o.end - o.start <= 60, s = o._s, hb = o.habit ? habitById(o.habit) : null, pill = '';
      if (hb) pill = s === 'd' ? '<span class="pill on">' + ic('check', 11) + ' ' + (phone ? 'Logged' : 'Logged to ' + esc(hb.name)) + '</span>' : s === 'x' ? '<span class="pill off">Not logged</span>' : '<span class="pill dash">' + (phone ? 'Auto-logs' : 'Auto-logs to ' + esc(hb.name)) + '</span>';
      var pw = 100 / o.cols, lf = o.col * pw, key = o.key;
      var sub = L.fmtMin(o.start) + ' – ' + L.fmtMin(o.end) + ' · ' + (phone && hb ? esc(hb.name) : t.name);
      return '<div class="tile' + (short ? ' short' : '') + (s === 'x' ? ' skip' : '') + '" style="top:' + top + 'px;height:' + hgt + 'px;left:calc(' + lf + '% + 4px);width:calc(' + pw + '% - 8px);background:' + t.fill + ';color:' + t.text + ';--c:' + t.box + ';--k:' + t.chk + '">' +
        '<button class="chk' + (s === 'd' ? ' on' : s === 'x' ? ' off' : '') + '" data-a="occ" data-k="' + esc(key) + '" aria-pressed="' + (s === 'd') + '" aria-label="' + esc(o.title + ': ' + (s === 'd' ? 'done. Tap if you did not do it' : s === 'x' ? 'not done. Tap to mark done' : 'planned. Tap to mark done')) + '">' + (s === 'd' ? ic('check', 14) : s === 'x' ? ic('x', 12) : '') + '</button>' +
        '<button class="tbody" data-a="open" data-k="' + esc(key) + '" aria-label="Edit ' + esc(o.title) + '"><span class="tt">' + esc(o.title) + '</span><span class="tm">' + sub + '</span></button>' + pill + '</div>';
    }).join('');

    var q = '';
    if (quick) {
      var qt = (quick.start - L.DAY_START) * HOUR_PX / 60 + 2, maxTop = 24 * HOUR_PX - 160;
      if (qt > maxTop) qt = maxTop;
      q = '<div class="quick" style="top:' + qt + 'px" role="group" aria-label="New block"><input class="qin" data-f="q-title" value="' + esc(quick.title) + '" placeholder="What are you doing?" aria-label="Title" autocomplete="off" enterkeyhint="done"><div class="chips">' +
        L.tagList(S).map(function (t) { return '<button class="chip' + (quick.tag === t.id ? ' on' : '') + '" style="' + tagStyle(t) + '" data-a="q-tag" data-t="' + t.id + '" aria-pressed="' + (quick.tag === t.id) + '"><i></i>' + t.name + '</button>'; }).join('') +
        '</div><div class="qrow"><span>' + timeSelect('q-start', quick.start, 'start') + ' – ' + timeSelect('q-end', quick.end, 'end') + '</span>' + (phone ? '' : '<span class="hint">Enter to add · Esc to cancel</span>') + '<span><button class="btn sm" data-a="q-more">Details</button> <button class="btn sm pri" data-a="q-add">Add</button></span></div></div>';
    }
    var nl = '', mins = Math.round((now - L.parse(sel)) / 60000);
    if (mins >= L.DAY_START && mins < L.DAY_END) nl = '<div class="nowl" style="top:' + ((mins - L.DAY_START) * HOUR_PX / 60) + 'px"><b>' + L.fmtMin(mins) + '</b><s></s><u></u></div>';
    return '<div class="grid" style="height:' + (24 * HOUR_PX) + 'px">' + rows + '<div class="ov">' + tiles + q + '</div>' + nl + '</div>';
  }

  function renderDay() {
    var st = dayStats(), pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    return '<div class="card" style="overflow:hidden"><div class="dayh"><div><div class="d1">' + DAYS[L.wd(sel)] + '</div><div class="muted">' + longDate(sel) + ' · Week ' + L.isoWeek(sel) + '</div></div>' +
      '<div class="prog">' + ringSvg(st.done, st.total, 40) + '<span>' + st.done + ' of ' + st.total + ' blocks done</span></div></div>' + gridHtml() + '</div>';
  }

  function timeSelect(f, val, kind, cls) {
    var o = '', from = kind === 'start' ? L.DAY_START : L.DAY_START + 15, to = kind === 'start' ? L.DAY_END - 15 : L.DAY_END, seen = false, m;
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
    head += '<span class="small muted hh" title="This week">Week<br>W' + L.isoWeek(today) + '</span><span class="small muted hh" title="This month">Done</span></div>';
    var body = S.habits.map(function (h) {
      var cells = '', st = L.monthStats(S, h.id, y, mo, now), chk = L.habitChk(h.color), wk = L.weekStats(S, h.id, today, now);
      for (i = 1; i <= n; i++) {
        d = y + '-' + L.pad(mo + 1) + '-' + L.pad(i);
        var s = L.habitDay(S, h.id, d, now), fut = d > today;
        cells += '<span class="hcw' + (d === today ? ' t' : '') + '"><button class="hc ' + s + '" style="--c:' + h.color + ';--k:' + chk + '" data-a="hab" data-h="' + h.id + '" data-d="' + d + '"' + (fut ? ' disabled' : '') + ' aria-label="' + esc(h.name + ', ' + shortDate(d) + ': ' + stateLabel(s)) + '">' + (s === 'done' ? ic('check', 14) : s === 'missed' ? ic('x', 12) : s === 'upcoming' ? '<i></i>' : '') + '</button></span>';
      }
      return '<div class="hrow b" style="--n:' + n + '"><span class="hl"><span class="sw" style="--c:' + h.color + '"></span><span class="hn">' + esc(h.name) + '</span></span>' + cells + '<span class="tot" title="This week: ' + wk.done + ' of ' + wk.planned + '">' + (wk.planned ? wk.done + '/' + wk.planned : '–') + '</span><span class="tot">' + st.done + '/' + st.planned + '</span></div>';
    }).join('');
    return '<div class="hv"><div class="cards">' + cards + '</div><div class="card pad tw"><div class="tin">' + head + body + '</div></div>' +
      '<div class="legend"><span><span class="lgd" style="background:#30D158;color:#06240F">' + ic('check', 11) + '</span>Done, logged automatically</span><span><span class="lgd" style="background:#2C2C2E;color:#AEAEB2">' + ic('x', 10) + '</span>Not done, you marked it</span><span><span class="lgd" style="border:2px dashed #409CFF"></span>Open today</span><span>Click any past circle to flip it.</span></div></div>';
  }

  /* ---------- dialogs ---------- */

  function renderDlg() {
    if (dlg) { $dlg.innerHTML = blockDlg(); return; }
    if (hdlg) { $dlg.innerHTML = habitDlg(); return; }
    if (ddlg) { $dlg.innerHTML = dataDlg(); return; }
    if (tdlg) { $dlg.innerHTML = tagDlg(); return; }
    $dlg.innerHTML = '';
  }
  function closeDlg() {
    dlg = null; hdlg = null; ddlg = null; tdlg = null; $dlg.innerHTML = '';
    var fresh = pendingRemote && !Store.dirty;
    if (fresh) S = pendingRemote;
    pendingRemote = null;
    if (fresh) render();
  }
  function openDlg(focusSel) {
    renderDlg();
    var f = $dlg.querySelector(focusSel || 'input,select,button'); if (f) f.focus();
  }

  function blockDlg() {
    var d = dlg, hb = d.habit ? habitById(d.habit) : null, wdName = DAYS[L.wd(d.series ? d.occDate : d.date)];
    var dateLocked = d.series && d.repeat !== 'once';
    var chips = L.tagList(S).map(function (t) { return '<button class="chip lg' + (d.tag === t.id ? ' on' : '') + '" style="' + tagStyle(t) + '" data-a="d-tag" data-t="' + t.id + '" aria-pressed="' + (d.tag === t.id) + '"><i></i>' + t.name + '</button>'; }).join('');
    var reps = [['once', 'Only this day'], ['weekly', 'Every ' + wdName], ['weekdays', 'Every weekday']].map(function (r) { return '<button data-a="d-rep" data-r="' + r[0] + '" aria-pressed="' + (d.repeat === r[0]) + '">' + r[1] + '</button>'; }).join('');
    var sel2 = d.habit ? '<div class="gpad" style="padding-top:0"><select class="fld" data-f="d-habit" aria-label="Habit">' + S.habits.map(function (h) { return '<option value="' + h.id + '"' + (h.id === d.habit ? ' selected' : '') + '>' + esc(h.name) + '</option>'; }).join('') + '</select></div>' : '';
    var foot;
    if (d.confirm) {
      foot = d.series
        ? '<div class="conf"><span>Delete this repeating block?</span><span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-a="d-del-cancel">Keep it</button><button class="btn sm danger" data-a="d-del-one">Only this day</button><button class="btn sm danger" data-a="d-del-follow">This and following</button></span></div>'
        : '<div class="conf"><span>Delete this block?</span><span style="display:flex;gap:8px"><button class="btn sm" data-a="d-del-cancel">Keep it</button><button class="btn sm danger" data-a="d-del-one">Delete</button></span></div>';
    } else {
      foot = d.id ? '<button class="dlist danger" data-a="d-del">Delete block</button>' : '';
    }
    return '<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dt"><div class="grab"></div><div class="dh"><button class="tl" data-a="d-cancel">Cancel</button><h2 id="dt">' + (d.id ? 'Edit block' : 'New block') + '</h2><button class="btn pri sm" data-a="d-save">Save</button></div>' +
      '<div class="grp"><input id="f-title" class="tin2" data-f="title" value="' + esc(d.title) + '" placeholder="Title" aria-label="Title" autocomplete="off"></div>' +
      '<div class="grp"><div class="grow2"><label for="f-date">Date</label><input id="f-date" type="date" class="ctl" data-f="date" value="' + d.date + '"' + (dateLocked ? ' disabled' : '') + '></div>' +
      '<div class="grow2"><label for="f-start">Starts</label>' + timeSelect('d-start', d.start, 'start', 'ctl').replace('<select', '<select id="f-start"') + '</div>' +
      '<div class="grow2"><label for="f-end">Ends</label>' + timeSelect('d-end', d.end, 'end', 'ctl').replace('<select', '<select id="f-end"') + '</div></div>' +
      '<div class="grp gpad"><span class="glab">Tag</span><div class="chips">' + chips + '</div></div>' +
      '<div class="grp"><div class="gpad hbar"><div><div style="font-weight:500">' + (hb ? 'Count toward ' + esc(hb.name) : 'Count toward a habit') + '</div><div class="note">Logs itself when the block ends. Tap its circle if you did not do it.</div></div><button class="sw2" role="switch" aria-checked="' + !!d.habit + '" aria-label="Count toward a habit" data-a="d-habit"><i></i></button></div>' + sel2 + '</div>' +
      '<div class="grp gpad"><span class="glab">Repeat</span><div class="segc" role="group" aria-label="Repeat">' + reps + '</div>' +
      (d.series ? '<div class="small muted" style="margin-top:8px">Changes to a repeating block apply to this day and the days after it. Earlier days stay as they were.</div>' : '') + '</div>' +
      '<div class="grp"><textarea id="f-notes" class="notes" data-f="notes" placeholder="Notes" aria-label="Notes">' + esc(d.notes) + '</textarea></div>' +
      (d.err ? '<div class="err" role="alert">' + esc(d.err) + '</div>' : '') + foot + '</div></div>';
  }

  /* One colour picker for tags and habits: a palette of large swatches plus a free hex field. */
  function swatchBtn(kind, id, color, label, open) {
    return '<button class="cswatch" style="--c:' + color + '" data-a="pk-open" data-kind="' + kind + '" data-id="' + esc(id) + '" aria-expanded="' + !!open + '" aria-label="Colour for ' + esc(label) + '"></button>';
  }
  function pickerHtml(kind, id, color) {
    var attrs = ' data-kind="' + kind + '" data-id="' + esc(id) + '"';
    return '<div class="picker"><div class="swgrid" role="group" aria-label="Colours">' + L.PALETTE.map(function (c) {
      return '<button class="sw3" style="--c:' + c + '" data-a="pk-sw"' + attrs + ' data-c="' + c + '" aria-pressed="' + (c === color) + '" aria-label="Colour ' + c + '"></button>';
    }).join('') + '</div><div class="hexrow"><span class="cpv" style="--c:' + color + '"' + attrs + '></span><label>Hex<input class="fld hex" data-f="pk-hex"' + attrs + ' value="' + color + '" maxlength="7" spellcheck="false" autocapitalize="characters" autocomplete="off" aria-label="Hex colour"></label></div></div>';
  }
  function setColor(kind, id, c) {
    if (kind === 'tag') L.updateTag(S, id, { color: c });
    else { var h = habitById(id); if (h) h.color = c; }
    Store.schedule();
  }
  /* Update the open picker in place, so typing a hex code keeps the cursor in the field. */
  function paintColor(kind, id, c) {
    [].forEach.call($dlg.querySelectorAll('.cswatch,.cpv'), function (el) { if (el.dataset.kind === kind && el.dataset.id === id) el.style.setProperty('--c', c); });
    [].forEach.call($dlg.querySelectorAll('.sw3'), function (el) { if (el.dataset.kind === kind && el.dataset.id === id) el.setAttribute('aria-pressed', String(el.dataset.c === c)); });
  }
  function focusSwatch(kind, id) {
    [].forEach.call($dlg.querySelectorAll('.cswatch'), function (el) { if (el.dataset.kind === kind && el.dataset.id === id) el.focus(); });
  }

  function tagDlg() {
    var only = S.tags.length < 2;
    var rows = L.tagList(S).map(function (t) {
      var open = tdlg.pick === t.id;
      return '<div class="hli"><input class="fld" data-f="tname" data-id="' + esc(t.id) + '" value="' + esc(t.name) + '" maxlength="24" aria-label="Tag name">' + swatchBtn('tag', t.id, t.color, t.name, open) +
        '<button class="btn sm danger" data-a="tg-del" data-id="' + esc(t.id) + '"' + (only ? ' disabled' : '') + '>' + (tdlg.confirm === t.id ? 'Confirm remove' : 'Remove') + '</button>' + (open ? pickerHtml('tag', t.id, t.color) : '') + '</div>';
    }).join('');
    return '<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dt"><div class="grab"></div><div class="dh"><h2 id="dt">Tags</h2><button class="ib" data-a="tg-close" aria-label="Close">' + ic('x', 16) + '</button></div>' +
      '<div class="note" style="margin-bottom:12px">Tags colour your blocks. Tap a colour dot to change it. Removing a tag moves its blocks to Personal, or to another tag if Personal is gone.</div><div class="hlist">' + rows + '</div>' +
      '<div class="df"><button class="btn" data-a="tg-add">' + ic('plus', 14) + ' Add tag</button><button class="btn pri" data-a="tg-close">Done</button></div></div></div>';
  }

  function habitDlg() {
    var rows = S.habits.map(function (h) {
      var open = hdlg.pick === h.id;
      return '<div class="hli"><input class="fld" data-f="hname" data-h="' + h.id + '" value="' + esc(h.name) + '" aria-label="Habit name">' + swatchBtn('habit', h.id, h.color, h.name, open) +
        '<button class="btn sm danger" data-a="hm-del" data-h="' + h.id + '">' + (hdlg.confirm === h.id ? 'Confirm remove' : 'Remove') + '</button>' + (open ? pickerHtml('habit', h.id, h.color) : '') + '</div>';
    }).join('');
    return '<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dt"><div class="grab"></div><div class="dh"><h2 id="dt">Habits</h2><button class="ib" data-a="hm-close" aria-label="Close">' + ic('x', 16) + '</button></div>' +
      '<div class="note" style="margin-bottom:12px">A block counts toward a habit when you pick it in the block’s editor. Removing a habit also removes its history.</div><div class="hlist">' + rows + '</div>' +
      '<div class="df"><button class="btn" data-a="hm-add">' + ic('plus', 14) + ' Add habit</button><button class="btn pri" data-a="hm-close">Done</button></div></div></div>';
  }

  function dataDlg() {
    var d = ddlg, where = Store.mode === 'cloud' ? 'Your planner is saved to your Claude account and syncs live between your devices.' : 'Your planner is saved in this browser on this device.';
    var pend = d.pending ? '<div class="conf"><span>Replace the current planner with the file (' + d.pending.blocks.length + ' blocks, ' + d.pending.habits.length + ' habits)?</span><span style="display:flex;gap:8px"><button class="btn sm" data-a="import-cancel">Cancel</button><button class="btn sm danger" data-a="import-ok">Replace</button></span></div>' : '';
    var rst = d.reset ? '<div class="conf"><span>Delete every block and all history?</span><span style="display:flex;gap:8px"><button class="btn sm" data-a="reset-cancel">Cancel</button><button class="btn sm danger" data-a="reset-ok">Delete everything</button></span></div>' : '';
    return '<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dt"><div class="grab"></div><div class="dh"><h2 id="dt">Data</h2><button class="ib" data-a="data-close" aria-label="Close">' + ic('x', 16) + '</button></div>' +
      '<div class="note">' + esc(where) + (Store.note ? ' ' + esc(Store.note) : '') + '</div>' +
      '<div class="drow"><span><b>Tags</b><div class="note">Add, rename and recolour tags.</div></span><button class="btn" data-a="tg-open">Edit tags</button></div>' +
      '<div class="drow"><span><b>Export</b><div class="note">Download a backup file of everything.</div></span><button class="btn" data-a="export">Export</button></div>' +
      '<div class="drow"><span><b>Import</b><div class="note">Load a backup file. This replaces what is here.</div></span><button class="btn" data-a="import-pick">Choose file</button><input type="file" id="imp" accept=".json,application/json" class="sr" tabindex="-1" aria-hidden="true"></div>' + pend +
      '<div class="drow"><span><b>Start over</b><div class="note">Delete all blocks and history.</div></span><button class="btn danger" data-a="reset">Reset</button></div>' + rst +
      (d.msg ? '<div class="note" role="status" style="margin-top:8px">' + esc(d.msg) + '</div>' : '') +
      '<div class="df"><span></span><button class="btn pri" data-a="data-close">Done</button></div></div></div>';
  }

  /* ================= actions ================= */

  function commit() { Store.schedule(); render(); }
  /* The day grid is 24 hours tall. Open it near the current time, or at 06:00 on other days. */
  function scrollToDay() {
    try {
      var g = document.querySelector('.grid'); if (!g || view !== 'day') return;
      var hd = document.querySelector('.ph,.top'), hh = hd ? hd.offsetHeight : 0;
      var mins = Math.round((now - L.parse(sel)) / 60000), isNow = sel === L.dk(now) && mins >= L.DAY_START && mins < L.DAY_END;
      var y = g.getBoundingClientRect().top + window.scrollY + (isNow ? mins : 360) * HOUR_PX / 60 - hh - (isNow ? 90 : 8);
      window.scrollTo(0, Math.max(0, y));
    } catch (e) { }
  }
  function syncCal() { var d = L.parse(sel); cal = { y: d.getFullYear(), m: d.getMonth() }; }
  function defaultStart() {
    var m = Math.floor((now - L.parse(sel)) / 60000);
    if (sel === L.dk(now) && m >= L.DAY_START && m < L.DAY_END) return Math.min(Math.ceil((m + 1) / 60) * 60, L.DAY_END - 60);
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
    var s = init && init.start != null ? init.start : defaultStart(), e = init && init.end != null ? init.end : Math.min(s + 60, L.DAY_END);
    var tag = L.tagById(S, (init && init.tag) || 'personal').id;
    dlg = { id: null, occDate: null, date: sel, title: (init && init.title) || '', tag: tag, start: s, end: e, habit: S.tagHabit[tag] || null, notes: '', repeat: 'once', series: false, err: '', confirm: false };
    quick = null; render(); openDlg('[data-f=title]');
  }

  var actions = {
    view: function (el) { view = el.dataset.v; quick = null; render(); if (view === 'day') scrollToDay(); },
    today: function () { now = new Date(); sel = L.dk(now); syncCal(); hv = { y: now.getFullYear(), m: now.getMonth() }; quick = null; render(); scrollToDay(); },
    prev: function () { if (view === 'day') { sel = L.addDays(sel, -1); syncCal(); quick = null; } else { hv.m--; if (hv.m < 0) { hv.m = 11; hv.y--; } } render(); },
    next: function () { if (view === 'day') { sel = L.addDays(sel, 1); syncCal(); quick = null; } else { hv.m++; if (hv.m > 11) { hv.m = 0; hv.y++; } } render(); },
    'cal-prev': function () { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } render(); },
    'cal-next': function () { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } render(); },
    pick: function (el) { sel = el.dataset.d; syncCal(); quick = null; calOpen = false; if (view !== 'day') view = 'day'; render(); scrollToDay(); },
    'cal-toggle': function () { calOpen = !calOpen; syncCal(); render(); },
    tag: function (el) {
      var t = el.dataset.t, i = S.hiddenTags.indexOf(t);
      if (i >= 0) S.hiddenTags.splice(i, 1); else S.hiddenTags.push(t);
      commit();
    },
    hab: function (el) { now = new Date(); if (L.toggleHabit(S, el.dataset.h, el.dataset.d, now)) commit(); },
    occ: function (el) { now = new Date(); var o = L.findOcc(S, el.dataset.k); if (o) { L.toggleOcc(S, o, now); commit(); } },
    open: function (el) { openEdit(el.dataset.k); },
    slot: function (el) {
      var s = +el.dataset.m;
      quick = { start: s, end: Math.min(s + 60, L.DAY_END), tag: L.tagById(S, lastTag).id, title: '', focus: true }; render();
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

    'hm-open': function () { hdlg = { confirm: null, pick: null }; openDlg('input'); },
    'hm-close': function () { closeDlg(); commit(); },
    'hm-add': function () {
      var c = L.PALETTE[S.habits.length % L.PALETTE.length];
      S.habits.push({ id: 'h-' + Math.random().toString(36).slice(2, 8), name: 'New habit', color: c });
      Store.schedule(); renderDlg();
      var ins = $dlg.querySelectorAll('input'); if (ins.length) { var l = ins[ins.length - 1]; l.focus(); l.select(); }
    },
    'tg-open': function () { quick = null; ddlg = null; tdlg = { pick: null, confirm: null }; openDlg('input'); },
    'tg-close': function () { closeDlg(); commit(); },
    'tg-add': function () {
      var r = L.addTag(S, 'New tag', L.PALETTE[S.tags.length % L.PALETTE.length]);
      if (!r.ok) return;
      tdlg.pick = null; tdlg.confirm = null; Store.schedule(); renderDlg();
      var ins = $dlg.querySelectorAll('.hli input'); if (ins.length) { var l = ins[ins.length - 1]; l.focus(); l.select(); }
    },
    'tg-del': function (el) {
      if (tdlg.confirm === el.dataset.id) { if (L.deleteTag(S, el.dataset.id).ok) { if (tdlg.pick === el.dataset.id) tdlg.pick = null; Store.schedule(); } tdlg.confirm = null; }
      else tdlg.confirm = el.dataset.id;
      renderDlg();
    },
    'pk-open': function (el) {
      var d = el.dataset.kind === 'tag' ? tdlg : hdlg;
      d.pick = d.pick === el.dataset.id ? null : el.dataset.id; renderDlg(); focusSwatch(el.dataset.kind, el.dataset.id);
    },
    'pk-sw': function (el) {
      setColor(el.dataset.kind, el.dataset.id, el.dataset.c); renderDlg();
      var on = $dlg.querySelector('.sw3[aria-pressed="true"]'); if (on) on.focus();
    },
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
    else if (f === 'tname') { if (L.updateTag(S, e.target.dataset.id, { name: v }).ok) Store.schedule(); }
    else if (f === 'pk-hex') {
      var c = L.normHex(v), k = e.target.dataset;
      e.target.classList.toggle('bad', !c && v.trim() !== '');
      if (c) { setColor(k.kind, k.id, c); paintColor(k.kind, k.id, c); }
    }
  });

  document.addEventListener('change', function (e) {
    var f = e.target.dataset && e.target.dataset.f, v = e.target.value;
    if (e.target.id === 'imp') { importFile(e.target.files && e.target.files[0]); return; }
    if (!f) return;
    if (f === 'q-start' && quick) { quick.start = +v; if (quick.end <= quick.start) quick.end = Math.min(quick.start + 60, L.DAY_END); quick.focus = false; render(); }
    else if (f === 'q-end' && quick) { quick.end = +v; if (quick.end <= quick.start) quick.start = Math.max(quick.end - 60, L.DAY_START); quick.focus = false; render(); }
    else if (f === 'd-start' && dlg) { dlg.start = +v; if (dlg.end <= dlg.start) dlg.end = Math.min(dlg.start + 60, L.DAY_END); renderDlg(); }
    else if (f === 'd-end' && dlg) { dlg.end = +v; if (dlg.end <= dlg.start) dlg.start = Math.max(dlg.end - 60, L.DAY_START); renderDlg(); }
    else if (f === 'date' && dlg) { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { dlg.date = v; renderDlg(); } }
    else if (f === 'd-habit' && dlg) { dlg.habit = v; renderDlg(); }
    else if (f === 'hname') { render(); }
    else if (f === 'tname' || f === 'pk-hex') { renderDlg(); }
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
      if (anyDlg()) { var wasEdit = !!(hdlg || tdlg); closeDlg(); if (wasEdit) commit(); else render(); }
      else if (quick) { quick = null; render(); }
    } else if (e.key === 'Enter' && quick && e.target.classList && e.target.classList.contains('qin')) {
      e.preventDefault(); quickAdd();
    } else if (e.key === 'Enter' && dlg && e.target.dataset && e.target.dataset.f === 'title') {
      e.preventDefault(); actions['d-save']();
    }
  });

  /* ================= phone gestures, live updates ================= */
  var tx = 0, ty = 0, tOk = false;
  document.addEventListener('touchstart', function (e) {
    tOk = phone && view === 'day' && !anyDlg() && !quick && e.target.closest && !!e.target.closest('.pmain');
    if (tOk && e.touches[0]) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!tOk || !e.changedTouches[0]) return; tOk = false;
    var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45) actions[dx < 0 ? 'next' : 'prev']();
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (ready && detectPhone() !== phone && !anyDlg() && !quick) render();
  });
  Store.onRemote = function (st) {
    if (anyDlg() || quick) { pendingRemote = st; return; }
    S = st; render();
  };

  /* ================= boot ================= */

  setInterval(function () {
    if (!ready || anyDlg() || quick) return;
    render();
  }, 30000);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { Store.flushNow(); return; }
    if (!ready) return;
    Store.refresh().then(function (st) {
      if (st && !anyDlg() && !quick) { S = st; render(); } else if (!st && !anyDlg() && !quick) render();
    });
  });
  window.addEventListener('pagehide', function () { Store.flushNow(); });

  Store.init().then(function () {
    ready = true; render(); scrollToDay();
  });

  window.__planner = { get S() { return S; }, Store: Store };
})();
