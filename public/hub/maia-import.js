// Popup opened by the Maia bookmarklet. It sends the student's college list (and
// any schools queued from the Scattergrams tab) to the Maia page right away,
// receives scattergram points back via postMessage, and saves them same-origin
// (with the workspace cookie) to /api/workspace/scattergrams. Afterwards the
// student can look up any other school from here while Maia stays open.
(function () {
  "use strict";

  var MAIA_ORIGIN = "https://app.maialearning.com";
  var SAVE_BATCH = 25; // colleges per POST, to stay well under the request size limit
  var QUEUE_KEY = "cf.maiaQueue"; // written by Scattergrams.jsx
  var FRESH_MS = 24 * 60 * 60 * 1000; // a school imported this recently is skipped, so clicking again resumes
  var remaining = []; // what a stopped run didn't get to, for the Resume button
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
    busy = false;
    stopping = false;
    setStatus(text, isError);
    el("cancel").textContent = "Close";
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

  async function save(payload, missing, cancelled, stopped) {
    showMissing(missing);
    var done = {};
    payload.colleges.concat((missing || []).filter(function (m) { return m.reason === "Not found in Maia"; })).forEach(function (c) { done[c.slug] = true; });
    remaining = stopped || cancelled ? colleges.filter(function (c) { return !done[c.slug]; }) : [];
    if (!payload.colleges.length) { finish(stopped ? String(stopped) : "Maia didn’t return scattergrams for " + (colleges.length === 1 ? colleges[0].name : "any of these colleges") + ".", true); return; }
    var total = payload.colleges.length;
    try {
      for (var i = 0; i < total; i += SAVE_BATCH) {
        setStatus("Saving to College Forge… (" + Math.min(i + SAVE_BATCH, total) + " of " + total + ")");
        await post({ classOfYears: payload.classOfYears, student: payload.student, colleges: payload.colleges.slice(i, i + SAVE_BATCH) });
      }
      dropFromQueue(payload.colleges.map(function (c) { return c.slug; }));
      var withData = payload.colleges.filter(function (c) { return c.points.length > 0; }).length;
      var what = total === 1 ? colleges[0].name + (withData ? "" : " (no applicants from your school)") : total + " colleges (" + withData + " with applicants from your school)";
      finish((cancelled ? "Stopped early. " : "") + "Imported " + what + "." + (stopped ? " " + stopped : ""), Boolean(stopped));
    } catch (e) {
      finish("Couldn’t save: " + (e.message || "unknown error") + ". Try again.", true);
    }
  }

  function onMessage(event) {
    if (event.origin !== MAIA_ORIGIN || event.source !== maia) return;
    var msg = event.data || {};
    if (msg.type === "cf-maia:ping") { if (colleges && busy) send("cf-maia:hello", colleges); return; }
    if (!busy) return;
    if (msg.type === "cf-maia:progress") {
      if (stopping) return;
      var pct = msg.total ? Math.round((msg.done / msg.total) * 100) : 0;
      el("bar").style.width = pct + "%";
      if (msg.waitSeconds) setStatus("Maia asked us to slow down. Waiting " + msg.waitSeconds + " seconds, then trying " + msg.name + " again…");
      else setStatus(msg.name ? "Checking " + msg.name + " (" + (msg.done + 1) + " of " + msg.total + ")…" : "Finishing up…");
    } else if (msg.type === "cf-maia:error") {
      finish(String(msg.error || "Something went wrong in Maia."), true);
      if (Array.isArray(msg.diagnostic)) {
        el("diagnostic-text").textContent = msg.diagnostic.map(function (d) { return JSON.stringify(d); }).join("\n").slice(0, 4000);
        el("diagnostic").hidden = false;
      }
    } else if (msg.type === "cf-maia:result" && msg.payload && Array.isArray(msg.payload.colleges)) {
      save(msg.payload, msg.missing, msg.cancelled, msg.stopped);
      if (Array.isArray(msg.diagnostic)) {
        el("diagnostic-text").textContent = msg.diagnostic.map(function (d) { return JSON.stringify(d); }).join("\n").slice(0, 4000);
        el("diagnostic").hidden = false;
      }
    }
  }

  // While a run is going, the first click stops it and keeps what was fetched; otherwise it closes.
  el("cancel").addEventListener("click", function () {
    if (!busy || stopping || !maiaOpen()) { window.close(); return; }
    stopping = true;
    maia.postMessage({ type: "cf-maia:cancel" }, MAIA_ORIGIN);
    setStatus("Stopping… saving what’s done so far.");
    el("cancel").textContent = "Close";
  });

  var known = {}; // slug → stored scattergram, for Maia ids and import times
  function toTarget(c) {
    var k = known[c.slug];
    return { slug: c.slug, name: c.name, scorecardId: c.scorecardId || null, nid: (k && k.maiaNid) || null };
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
    var seen = {};
    var all = list.concat(readQueue()).filter(function (c) { return !seen[c.slug] && (seen[c.slug] = true); }).map(toTarget);
    if (!all.length) { finish("Your list is empty. Look up any school below, or add colleges in College Forge first."); return; }
    // Resume: skip schools imported in the last day, never-imported ones first. If all are fresh, refresh them all.
    var age = function (c) { return known[c.slug] ? known[c.slug].fetchedAt || 0 : -1; };
    var stale = all.filter(function (c) { return Date.now() - age(c) > FRESH_MS || age(c) < 0; }).sort(function (a, b) { return age(a) - age(b); });
    var chosen = stale.length ? stale : all;
    var skipped = all.length - chosen.length;
    setStatus("Importing " + chosen.length + " colleges" + (skipped ? " (" + skipped + " imported in the last day are skipped)" : "") + ". Waiting for Maia…");
    begin(chosen, true);
  }

  start();
})();
