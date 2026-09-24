// Popup opened by the Maia bookmarklet. It sends the student's college list to
// the Maia page, receives scattergram points back via postMessage, and saves
// them same-origin (with the workspace cookie) to /api/workspace/scattergrams.
(function () {
  "use strict";

  var MAIA_ORIGIN = "https://app.maialearning.com";
  var SAVE_BATCH = 25; // colleges per POST, to stay well under the request size limit
  var SCOPE_KEY = "cf.maiaScope";
  var maia = window.opener;
  var colleges = null;
  var finished = false;
  var el = function (id) { return document.getElementById(id); };

  function setStatus(text, isError) {
    el("status").textContent = text;
    el("status").className = "status" + (isError ? " error" : "");
  }

  function finish(text, isError) {
    finished = true;
    setStatus(text, isError);
    el("cancel").textContent = "Close";
    el("open").hidden = Boolean(isError);
  }

  function hello() {
    if (maia && !maia.closed && colleges) maia.postMessage({ type: "cf-maia:hello", colleges: colleges }, MAIA_ORIGIN);
  }

  function showMissing(missing) {
    if (!missing || !missing.length) return;
    var list = el("missing");
    missing.slice(0, 50).forEach(function (m) {
      var li = document.createElement("li");
      li.textContent = m.name + " — " + m.reason;
      list.appendChild(li);
    });
    list.hidden = false;
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

  async function save(payload, missing, cancelled) {
    if (!payload.colleges.length) { showMissing(missing); finish("Maia didn’t return scattergrams for any of these colleges.", true); return; }
    var total = payload.colleges.length;
    try {
      for (var i = 0; i < total; i += SAVE_BATCH) {
        setStatus("Saving to College Forge… (" + Math.min(i + SAVE_BATCH, total) + " of " + total + ")");
        await post({ classOfYears: payload.classOfYears, student: payload.student, colleges: payload.colleges.slice(i, i + SAVE_BATCH) });
      }
      var withData = payload.colleges.filter(function (c) { return c.points.length > 0; }).length;
      showMissing(missing);
      finish((cancelled ? "Stopped early. " : "") + "Imported " + payload.colleges.length + " colleges (" + withData + " with applicants from your school).");
    } catch (e) {
      finish("Couldn’t save: " + (e.message || "unknown error") + ". Try again.", true);
    }
  }

  function onMessage(event) {
    if (event.origin !== MAIA_ORIGIN || event.source !== maia) return;
    var msg = event.data || {};
    if (msg.type === "cf-maia:ping") { hello(); return; }
    if (finished) return;
    if (msg.type === "cf-maia:progress") {
      if (stopping) return;
      var pct = msg.total ? Math.round((msg.done / msg.total) * 100) : 0;
      el("bar").style.width = pct + "%";
      setStatus(msg.name ? "Checking " + msg.name + " (" + (msg.done + 1) + " of " + msg.total + ")…" : "Finishing up…");
    } else if (msg.type === "cf-maia:error") {
      finish(String(msg.error || "Something went wrong in Maia."), true);
      if (Array.isArray(msg.diagnostic)) {
        el("diagnostic-text").textContent = msg.diagnostic.map(function (d) { return JSON.stringify(d); }).join("\n").slice(0, 4000);
        el("diagnostic").hidden = false;
      }
    } else if (msg.type === "cf-maia:result" && msg.payload && Array.isArray(msg.payload.colleges)) {
      save(msg.payload, msg.missing, msg.cancelled);
    }
  }

  // First click stops the run and keeps what was already fetched; afterwards it closes.
  var stopping = false;
  el("cancel").addEventListener("click", function () {
    if (finished || stopping || !colleges || !maia || maia.closed) { window.close(); return; }
    stopping = true;
    maia.postMessage({ type: "cf-maia:cancel" }, MAIA_ORIGIN);
    setStatus("Stopping… saving what’s done so far.");
    el("cancel").textContent = "Close";
  });

  function toTarget(c) { return { slug: c.slug, name: c.name, scorecardId: c.scorecardId || null }; }

  /** The student's list first, then ranked schools up to `topN` that aren't already on it. */
  function chooseColleges(list, ranked, topN) {
    var seen = {};
    list.forEach(function (c) { seen[c.slug] = true; });
    var extra = ranked.filter(function (c) { return c.rank <= topN && !seen[c.slug]; });
    return list.concat(extra).map(toTarget);
  }

  // The ranking only feeds the "top N" options, so the import still works without it.
  async function loadRanked() {
    try {
      var res = await fetch("/api/colleges/search?browse=1", { credentials: "same-origin" });
      var j = await res.json();
      if (!res.ok || !j.success || !Array.isArray(j.data)) throw new Error("browse failed");
      return j.data.filter(function (c) { return typeof c.rank === "number" && c.rank > 0; }).sort(function (a, b) { return a.rank - b.rank; });
    } catch (e) {
      return [];
    }
  }

  function remembered() {
    try { return localStorage.getItem(SCOPE_KEY) || "0"; } catch (e) { return "0"; }
  }

  function scopeInputs() { return Array.prototype.slice.call(document.querySelectorAll('input[name="scope"]')); }

  function begin(list, ranked) {
    var checked = scopeInputs().filter(function (i) { return i.checked; })[0];
    var topN = checked ? Number(checked.value) || 0 : 0;
    try { localStorage.setItem(SCOPE_KEY, String(topN)); } catch (e) { /* private mode */ }
    var chosen = chooseColleges(list, ranked, topN);
    if (!chosen.length) { setStatus("Your list is empty. Add colleges in College Forge or pick a U.S. News option.", true); return; }
    el("scope").hidden = true;
    colleges = chosen;
    var extra = chosen.length - list.length;
    setStatus("Importing " + chosen.length + " colleges" + (extra > 0 && list.length ? " (" + list.length + " from your list, " + extra + " top-ranked)" : "") + ". Waiting for Maia…");
    hello();
  }

  async function start() {
    if (!maia) { finish("Open this from the College Forge bookmark while you’re on app.maialearning.com.", true); return; }
    window.addEventListener("message", onMessage);
    var list;
    try {
      var res = await fetch("/api/workspace", { credentials: "same-origin" });
      if (!res.ok) throw new Error("load failed");
      var ws = await res.json();
      list = ws.colleges || [];
    } catch (e) {
      finish("Couldn’t load your College Forge list. Refresh College Forge and try again.", true);
      return;
    }
    var ranked = await loadRanked();
    var inputs = scopeInputs();
    var want = ranked.length ? remembered() : "0";
    inputs.forEach(function (i) {
      if (!ranked.length) i.disabled = i.value !== "0";
      i.checked = i.value === want;
    });
    if (!inputs.some(function (i) { return i.checked; })) inputs[0].checked = true;
    el("start").addEventListener("click", function () { begin(list, ranked); });
    el("scope").hidden = false;
    setStatus(list.length + " colleges on your list. Choose what to import." + (ranked.length ? " Larger imports take a few minutes." : ""));
  }

  start();
})();
