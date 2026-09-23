// Popup opened by the Maia bookmarklet. It sends the student's college list to
// the Maia page, receives scattergram points back via postMessage, and saves
// them same-origin (with the workspace cookie) to /api/workspace/scattergrams.
(function () {
  "use strict";

  var MAIA_ORIGIN = "https://app.maialearning.com";
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

  async function save(payload, missing, cancelled) {
    if (!payload.colleges.length) { showMissing(missing); finish("Maia didn’t return scattergrams for any college on your list.", true); return; }
    setStatus("Saving to College Forge…");
    try {
      var res = await fetch("/api/workspace/scattergrams", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok || j.success === false) throw new Error(j.error || "Save failed");
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
    } else if (msg.type === "cf-maia:result" && msg.payload && Array.isArray(msg.payload.colleges)) {
      save(msg.payload, msg.missing, msg.cancelled);
    }
  }

  // First click stops the run and keeps what was already fetched; afterwards it closes.
  var stopping = false;
  el("cancel").addEventListener("click", function () {
    if (finished || stopping || !maia || maia.closed) { window.close(); return; }
    stopping = true;
    maia.postMessage({ type: "cf-maia:cancel" }, MAIA_ORIGIN);
    setStatus("Stopping… saving what’s done so far.");
    el("cancel").textContent = "Close";
  });

  async function start() {
    if (!maia) { finish("Open this from the College Forge bookmark while you’re on app.maialearning.com.", true); return; }
    window.addEventListener("message", onMessage);
    try {
      var res = await fetch("/api/workspace", { credentials: "same-origin" });
      if (!res.ok) throw new Error("load failed");
      var ws = await res.json();
      colleges = (ws.colleges || []).map(function (c) { return { slug: c.slug, name: c.name, scorecardId: c.scorecardId || null }; });
    } catch (e) {
      finish("Couldn’t load your College Forge list. Refresh College Forge and try again.", true);
      return;
    }
    if (!colleges.length) { finish("Your list is empty. Add colleges in College Forge first, then run the import again.", true); return; }
    setStatus("Found " + colleges.length + " colleges on your list. Waiting for Maia…");
    hello();
  }

  start();
})();
