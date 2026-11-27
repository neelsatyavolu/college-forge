// Popup opened by the Maia bookmarklet. It sends the student's college list (and
// any schools queued from the Scattergrams tab) to the Maia page right away,
// receives scattergram points back via postMessage, and saves them same-origin
// (with the workspace cookie) to /api/workspace/scattergrams. Afterwards the
// student can look up any other school from here while Maia stays open.
(function () {
  "use strict";

  var MAIA_ORIGIN = "https://app.maialearning.com";
  var SAVE_BATCH = 5; // colleges per POST: small, so little is lost if a run stops
  var QUEUE_KEY = "cf.maiaQueue"; // written by Scattergrams.jsx
  var FRESH_MS = 14 * 24 * 60 * 60 * 1000; // a school imported in the last two weeks isn't fetched again
  var remaining = []; // what a stopped run didn't get to, for the Resume button
  var countdown = null; // ticks the "trying again in N seconds" status
  var SEARCH_BUSY = "Maia's college search is busy; the next run tries again"; // same text as public/maia/import.js
  var unitIds = {}; // slug → federal Scorecard id, so Maia can find a school without its rate-limited name search
  var maia = window.opener;
  var colleges = null;
  var busy = false;
  var stopping = false;
  var el = function (id) { return document.getElementById(id); };

  function setStatus(text, isError) {
    el("status").textContent = text;
    el("status").className = "status" + (isError ? " error" : "");
  }

  function maiaOpen() { return Boolean(maia && !maia.closed); }

  /** A run ended: show the result and offer a lookup while Maia is still open. */
  function finish(text, isError) {
    clearInterval(countdown);
    busy = false;
    stopping = false;
    setStatus(text, isError);
    el("cancel").textContent = "Close";
    el("cancel").disabled = false;
    el("open").hidden = false;
    el("lookup").hidden = !maiaOpen();
    el("resume").hidden = !(remaining.length && maiaOpen());
    if (!el("resume").hidden) el("resume").textContent = "Resume (" + remaining.length + " left)";
  }

  function send(type, list) {
    if (maiaOpen()) maia.postMessage({ type: type, colleges: list }, MAIA_ORIGIN);
  }

  function showMissing(missing) {
    var list = el("missing");
    list.textContent = "";
    if (!missing || !missing.length) { list.hidden = true; return; }
    missing.slice(0, 50).forEach(function (m) {
      var li = document.createElement("li");
      li.textContent = m.name + " — " + m.reason;
      list.appendChild(li);
    });
    list.hidden = false;
  }

  function readQueue() {
    try {
      var q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      return Array.isArray(q) ? q.filter(function (c) { return c && typeof c.slug === "string" && typeof c.name === "string"; }) : [];
    } catch (e) { return []; }
  }

  function dropFromQueue(slugs) {
    try {
      var done = {};
      slugs.forEach(function (s) { done[s] = true; });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(readQueue().filter(function (c) { return !done[c.slug]; })));
    } catch (e) { /* private mode */ }
  }

  async function post(body) {
    var res = await fetch("/api/workspace/scattergrams", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok || j.success === false) throw new Error(j.error || "Save failed");
  }

  // Schools are saved as they arrive (a few per request, one request at a time), so
  // stopping, closing this window or a Maia error loses at most the last few.
  var pending = [];
  var savedSlugs = {};
  var savedCount = 0;
  var meta = { classOfYears: null, student: null };
  var saving = Promise.resolve();
  var saveError = null;

  function flush() {
    if (!pending.length) return saving;
    var batch = pending.splice(0, pending.length);
    saving = saving.then(function () {
      return post({ classOfYears: meta.classOfYears, student: meta.student, colleges: batch }).then(function () {
        batch.forEach(function (c) { savedSlugs[c.slug] = true; });
        savedCount += batch.length;
        dropFromQueue(batch.map(function (c) { return c.slug; }));
      }, function (e) { saveError = e; });
    });
    return saving;
  }

  function received(college, classOfYears, student) {
    if (!college || typeof college.slug !== "string" || savedSlugs[college.slug] || pending.some(function (c) { return c.slug === college.slug; })) return;
    if (classOfYears) meta.classOfYears = classOfYears;
    if (student && !meta.student) meta.student = student;
    pending.push(college);
    if (pending.length >= SAVE_BATCH) flush();
  }

  async function save(payload, missing, cancelled, stopped) {
    showMissing(missing);
    payload.colleges.forEach(function (c) { received(c, payload.classOfYears, payload.student); });
    setStatus("Saving to College Forge…");
    await flush();
    // Resume covers what isn't saved yet, except schools Maia doesn't have.
    var notFound = {};
    (missing || []).forEach(function (m) { if (m.reason === "Not found in Maia") notFound[m.slug] = true; });
    var searchBusy = (missing || []).filter(function (m) { return m.reason === SEARCH_BUSY; }).length;
    remaining = stopped || cancelled || saveError || searchBusy ? colleges.filter(function (c) { return !savedSlugs[c.slug] && !notFound[c.slug]; }) : [];
    var later = searchBusy ? " " + searchBusy + " couldn’t be looked up because Maia’s search is busy; click the bookmark again in a while to get them." : "";
    if (saveError) { finish("Saved " + savedCount + " colleges, then couldn’t save more: " + (saveError.message || "unknown error") + ". Resume to try the rest.", true); return; }
    if (!payload.colleges.length) { finish(stopped ? String(stopped) : later ? later.trim() : "Maia didn’t return scattergrams for " + (colleges.length === 1 ? colleges[0].name : "any of these colleges") + ".", true); return; }
    var total = payload.colleges.length;
    var withData = payload.colleges.filter(function (c) { return c.points.length > 0; }).length;
    var what = total === 1 ? colleges[0].name + (withData ? "" : " (no applicants from your school)") : total + " colleges (" + withData + " with applicants from your school)";
    finish((cancelled ? "Stopped early. " : "") + "Imported " + what + "." + (stopped ? " " + stopped : "") + later, Boolean(stopped));
  }

  function showDiagnostic(diagnostic) {
    if (!Array.isArray(diagnostic)) return;
    el("diagnostic-text").textContent = diagnostic.map(function (d) { return JSON.stringify(d); }).join("\n").slice(0, 4000);
    el("diagnostic").hidden = false;
  }

  function onMessage(event) {
    if (event.origin !== MAIA_ORIGIN || event.source !== maia) return;
    var msg = event.data || {};
    if (msg.type === "cf-maia:ping") { if (colleges && busy) send("cf-maia:hello", colleges); return; }
    // The Maia tab is in the background, where Chrome slows its timers; this window times its pauses.
    if (msg.type === "cf-maia:sleep") {
      var ms = Math.min(Math.max(Number(msg.ms) || 0, 0), 300000);
      setTimeout(function () { if (maiaOpen()) maia.postMessage({ type: "cf-maia:wake", id: msg.id }, MAIA_ORIGIN); }, ms);
      return;
    }
    if (!busy) return;
    if (msg.type === "cf-maia:college") {
      received(msg.college, msg.classOfYears, msg.student);
    } else if (msg.type === "cf-maia:progress") {
      if (stopping) return;
      var pct = msg.total ? Math.round((msg.done / msg.total) * 100) : 0;
      el("bar").style.width = pct + "%";
      var saved = savedCount ? " · " + savedCount + " saved" : "";
      clearInterval(countdown);
      if (msg.waitSeconds) {
        var until = Date.now() + msg.waitSeconds * 1000;
        var show = function () {
          var left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
          if (!stopping && busy) setStatus("Maia asked us to slow down. Trying " + msg.name + " again in " + left + " seconds…" + saved);
          if (!left) clearInterval(countdown);
        };
        show();
        countdown = setInterval(show, 1000);
      } else setStatus((msg.name ? "Checking " + msg.name + " (" + (msg.done + 1) + " of " + msg.total + ")…" : "Finishing up…") + saved);
    } else if (msg.type === "cf-maia:error") {
      // Keep whatever already arrived before reporting the error.
      flush().then(function () { finish(String(msg.error || "Something went wrong in Maia.") + (savedCount ? " " + savedCount + " colleges were saved." : ""), true); });
      showDiagnostic(msg.diagnostic);
    } else if (msg.type === "cf-maia:result" && msg.payload && Array.isArray(msg.payload.colleges)) {
      save(msg.payload, msg.missing, msg.cancelled, msg.stopped);
      showDiagnostic(msg.diagnostic);
    }
  }

  // While a run is going, the button stops it; it stays disabled until what was fetched is saved.
  el("cancel").addEventListener("click", function () {
    if (!busy || !maiaOpen()) { window.close(); return; }
    if (stopping) return;
    stopping = true;
    maia.postMessage({ type: "cf-maia:cancel" }, MAIA_ORIGIN);
    setStatus("Stopping… saving what’s done so far.");
    el("cancel").textContent = "Stopping…";
    el("cancel").disabled = true;
  });

  // Closing mid-run would drop the schools not yet saved, so ask first.
  window.addEventListener("beforeunload", function (e) {
    if (busy || pending.length) { e.preventDefault(); e.returnValue = ""; }
  });

  var known = {}; // slug → stored scattergram, for Maia ids and import times
  function toTarget(c) {
    var k = known[c.slug];
    return { slug: c.slug, name: c.name, scorecardId: c.scorecardId || unitIds[c.slug] || null, nid: (k && k.maiaNid) || null };
  }

  el("resume").addEventListener("click", function () {
    if (!remaining.length || busy) return;
    setStatus("Resuming with " + remaining.length + " colleges…");
    begin(remaining, false);
  });

  /** Start a run. The first one says hello (the Maia page may still be loading); later ones ask for a fetch. */
  function begin(list, first) {
    colleges = list;
    busy = true;
    saveError = null;
    el("lookup").hidden = true;
    el("open").hidden = true;
    el("resume").hidden = true;
    el("cancel").textContent = "Stop";
    el("bar").style.width = "0%";
    send(first ? "cf-maia:hello" : "cf-maia:fetch", colleges);
  }

  // ── Look up any school ────────────────────────────────────────────────
  var searchTimer = null;
  var searchSeq = 0;
  function renderResults(rows) {
    var box = el("results");
    box.textContent = "";
    rows.slice(0, 8).forEach(function (c) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c.name + (c.location ? " · " + String(c.location).split(" · ")[0] : "");
      b.addEventListener("click", function () {
        el("q").value = "";
        box.textContent = "";
        setStatus("Looking up " + c.name + " in Maia…");
        begin([toTarget(c)], false);
      });
      li.appendChild(b);
      box.appendChild(li);
    });
  }

  el("q").addEventListener("input", function () {
    var q = el("q").value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) { renderResults([]); return; }
    searchTimer = setTimeout(async function () {
      var seq = ++searchSeq;
      try {
        var res = await fetch("/api/colleges/search?q=" + encodeURIComponent(q), { credentials: "same-origin" });
        var j = await res.json();
        if (seq === searchSeq) renderResults(res.ok && j.success && Array.isArray(j.data) ? j.data : []);
      } catch (e) {
        if (seq === searchSeq) renderResults([]);
      }
    }, 250);
  });

  async function start() {
    if (!maia) { setStatus("Open this from the College Forge bookmark while you’re on app.maialearning.com.", true); return; }
    window.addEventListener("message", onMessage);
    var list;
    try {
      var res = await fetch("/api/workspace", { credentials: "same-origin" });
      if (!res.ok) throw new Error("load failed");
      var ws = await res.json();
      list = ws.colleges || [];
      var sg = await fetch("/api/workspace/scattergrams", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return null; });
      known = (sg && sg.data && sg.data.colleges) || {};
    } catch (e) {
      setStatus("Couldn’t load your College Forge list. Refresh College Forge and try again.", true);
      return;
    }
    // Your list first, then schools you queued from the Scattergrams tab.
    // Schools without a saved Maia id or Scorecard id would need Maia's rate-limited
    // name search; Forge's catalog supplies the Scorecard id for most of them.
    var needIds = list.concat(readQueue()).some(function (c) { return !c.scorecardId && !(known[c.slug] && known[c.slug].maiaNid); });
    if (needIds) {
      try {
        var cat = await fetch("/api/colleges/search?browse=1", { credentials: "same-origin" }).then(function (r) { return r.json(); });
        (cat && Array.isArray(cat.data) ? cat.data : []).forEach(function (c) { if (c && c.slug && c.scorecardId) unitIds[c.slug] = c.scorecardId; });
      } catch (e) { /* the name search still works, just slower to get through */ }
    }
    var seen = {};
    var all = list.concat(readQueue()).filter(function (c) { return !seen[c.slug] && (seen[c.slug] = true); }).map(toTarget);
    if (!all.length) { finish("Your list is empty. Look up any school below, or add colleges in College Forge first."); return; }
    // Fetch only schools never imported or imported more than two weeks ago, never-imported first.
    var age = function (c) { return known[c.slug] ? known[c.slug].fetchedAt || 0 : -1; };
    var stale = all.filter(function (c) { return Date.now() - age(c) > FRESH_MS || age(c) < 0; }).sort(function (a, b) { return age(a) - age(b); });
    var skipped = all.length - stale.length;
    if (!stale.length) { finish("All " + all.length + " colleges were imported in the last two weeks, so there’s nothing to fetch. Look up any other school below."); return; }
    setStatus("Importing " + stale.length + " colleges" + (skipped ? " (" + skipped + " imported in the last two weeks are skipped)" : "") + ". Waiting for Maia…");
    begin(stale, true);
  }

  start();
})();
