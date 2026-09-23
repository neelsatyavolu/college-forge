// College Forge ← Maia Learning scattergram import.
// Loaded by the Forge bookmarklet while the student is signed in to
// app.maialearning.com. It calls Maia's API with the student's own session,
// then hands only the scattergram points to the Forge popup via postMessage.
// The Maia token never leaves this page.
(function () {
  "use strict";

  var MAIA_HOST = "app.maialearning.com";
  var API = "https://app-www-maia.maialearning.com/ajs-services";
  var CLASS_OF_YEARS = "4"; // Maia's own default for the scattergram view
  var DELAY_MS = 350; // be polite: one school at a time
  var JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

  // ── Pure helpers (exercised by tests/maia-import.test.cjs) ──────────────
  function parseStored(raw) {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }

  function findJwt(value, depth) {
    if (typeof value === "string") {
      var s = value.replace(/^Bearer\s+/i, "").trim();
      return JWT.test(s) ? s : null;
    }
    if (!value || typeof value !== "object" || (depth || 0) > 2) return null;
    for (var k in value) {
      var hit = findJwt(value[k], (depth || 0) + 1);
      if (hit) return hit;
    }
    return null;
  }

  function findId(value, keys) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && /^\d{1,12}$/.test(value.trim())) return value.trim();
    if (!value || typeof value !== "object") return null;
    for (var i = 0; i < keys.length; i++) {
      var hit = findId(value[keys[i]], []);
      if (hit) return hit;
    }
    return null;
  }

  function jwtClaims(token) {
    try {
      var p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(p + "===".slice((p.length + 3) % 4)));
    } catch (e) { return {}; }
  }

  var SCHOOL_KEYS = ["school_nid", "school_id", "schoolNid", "schoolId", "nid", "id"];
  var USER_KEYS = ["student_uid", "uid", "user_id", "userId", "id"];

  /** Read the session the Maia app itself uses. `storage` is a Storage-like object. */
  function readSession(storage) {
    var token = findJwt(parseStored(storage.getItem("userAccessKey"))) || findJwt(parseStored(storage.getItem("userToken")));
    if (!token) {
      for (var i = 0; i < storage.length && !token; i++) token = findJwt(parseStored(storage.getItem(storage.key(i))));
    }
    var claims = token ? jwtClaims(token) : {};
    var schoolId = findId(parseStored(storage.getItem("sel_school")), SCHOOL_KEYS) || findId(claims, ["school_nid", "school_id", "schoolId"]);
    var studentUid = findId(parseStored(storage.getItem("sel_user")), USER_KEYS) || findId(claims, ["uid", "user_id", "userId", "sub"]);
    return { token: token, schoolId: schoolId, studentUid: studentUid };
  }

  /**
   * Shape of the storage entries readSession looks at — key names, types and
   * lengths only, never values — so a failed run can be diagnosed without
   * exposing the student's session.
   */
  function describeStorage(storage) {
    var keys = ["userAccessKey", "userToken", "userRefreshKey", "sel_school", "sel_user"];
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i);
      if (keys.indexOf(k) < 0 && /token|auth|user|school|session/i.test(k)) keys.push(k);
    }
    return keys.slice(0, 20).map(function (key) {
      var raw = storage.getItem(key);
      if (raw == null) return { key: key, kind: "missing" };
      var v = parseStored(raw);
      var shape = { key: key, kind: v === raw ? "text" : "json-" + (Array.isArray(v) ? "array" : typeof v), len: raw.length, jwt: Boolean(findJwt(v)) };
      if (typeof v === "string" || typeof v === "number") shape.digitsOnly = /^\d+$/.test(String(v).trim());
      if (v && typeof v === "object" && !Array.isArray(v)) {
        shape.fields = Object.keys(v).slice(0, 15).map(function (f) {
          var t = v[f] === null ? "null" : Array.isArray(v[f]) ? "array" : typeof v[f];
          return f.slice(0, 30) + ":" + t + (/^\d+$/.test(String(v[f])) ? "(digits)" : "");
        });
      }
      return shape;
    });
  }

  function num(v) {
    if (v === null || v === undefined || v === "" || v === "null") return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Maia returns points as numeric keys on an object, or [] when there are none. */
  function normalizeScatter(raw) {
    var r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var points = [];
    Object.keys(r).forEach(function (k) {
      var v = r[k];
      if (!/^\d+$/.test(k) || !v || typeof v !== "object") return;
      var sat = num(v.sat);
      points.push({ sat: sat === null ? null : Math.round(sat), gpa: num(v.gpa), result: String(v.result || "Unknown").trim(), round: v.type ? String(v.type).trim() : null });
    });
    var ctd = r.college_table_data || {};
    var st = r.student || {};
    return {
      points: points,
      averages: { gpa: num(r.avg_gpa != null ? r.avg_gpa : ctd.gpa), sat: num(r.avg_sat != null ? r.avg_sat : ctd.sat) },
      student: { gpa: num(st.gpa), wgpa: num(st.wgpa), sat: num(st.sat) },
    };
  }

  /** Pick the best Maia search hit for a college name. */
  function pickSearchHit(data, name) {
    if (!data || typeof data !== "object") return null;
    var items = Object.keys(data).filter(function (k) { return /^\d+$/.test(k) && data[k] && data[k].nid; }).map(function (k) { return data[k]; });
    if (!items.length) return null;
    var want = String(name).toLowerCase().trim();
    var exact = items.filter(function (it) { return String(it.title || "").toLowerCase().trim() === want; })[0];
    if (exact) return exact;
    var close = items.filter(function (it) { return String(it.title || "").toLowerCase().indexOf(want) >= 0; })[0];
    return close || (items.length === 1 ? items[0] : null);
  }

  var helpers = { readSession: readSession, describeStorage: describeStorage, normalizeScatter: normalizeScatter, pickSearchHit: pickSearchHit, findJwt: findJwt, findId: findId };
  if (typeof window !== "undefined" && window.__CF_MAIA_TEST__) { window.__CF_MAIA_TEST__ = helpers; return; }

  // ── Run in the browser ─────────────────────────────────────────────────
  var script = document.currentScript;
  var FORGE = script && script.src ? new URL(script.src).origin : null;
  var popup = window.__cfMaiaPopup;

  if (location.hostname !== MAIA_HOST) { alert("Open app.maialearning.com, sign in, then click the College Forge bookmark again."); return; }
  if (!FORGE) return;
  if (!popup || popup.closed) { alert("College Forge couldn't open its import window. Allow pop-ups for app.maialearning.com and click the bookmark again."); return; }

  // Each bookmark click reuses the same named popup. Only the newest run may act;
  // older runs stop at their next step and stay silent.
  var generation = (window.__cfMaiaGeneration || 0) + 1;
  window.__cfMaiaGeneration = generation;
  function current() { return window.__cfMaiaGeneration === generation; }

  var cancelled = false;
  function active() { return !cancelled && !popup.closed && current(); }
  function send(msg) { if (!popup.closed && current()) popup.postMessage(msg, FORGE); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function api(session, method, path, body) {
    return fetch(API + "/" + path, {
      method: method,
      headers: { authorization: "Bearer " + session.token, "content-type": "application/json", accept: "application/json, text/plain, */*" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Your Maia session expired. Reload Maia, then click the bookmark again."), { fatal: true });
      if (!res.ok) throw new Error("Maia returned " + res.status);
      return res.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function collegeNid(session, college) {
    var byUnit = college.scorecardId
      ? api(session, "GET", "college_nid_by_unitid/" + encodeURIComponent(college.scorecardId)).then(function (d) { return d && d.nid ? { nid: d.nid, title: null } : null; }, function (e) { if (e.fatal) throw e; return null; })
      : Promise.resolve(null);
    return byUnit.then(function (hit) {
      if (hit) return hit;
      return api(session, "POST", "college_search_for_add", { search: college.name }).then(function (d) {
        var best = pickSearchHit(d, college.name);
        return best ? { nid: best.nid, title: best.title || null } : null;
      });
    });
  }

  async function run(colleges) {
    try {
      var session = readSession(localStorage);
      if (!session.token || !session.schoolId || !session.studentUid) {
        var lacking = [!session.token && "sign-in token", !session.schoolId && "school ID", !session.studentUid && "student ID"].filter(Boolean);
        send({
          type: "cf-maia:error",
          error: "Couldn't find your Maia " + lacking.join(", ") + " on this page. Open the Universities tab in Maia, reload, then click the bookmark again.",
          diagnostic: describeStorage(localStorage),
        });
        return;
      }
      var out = [], missing = [], student = null;
      for (var i = 0; i < colleges.length && active(); i++) {
        var c = colleges[i];
        send({ type: "cf-maia:progress", done: i, total: colleges.length, name: c.name });
        try {
          var hit = await collegeNid(session, c);
          if (!hit) { missing.push({ slug: c.slug, name: c.name, reason: "Not found in Maia" }); continue; }
          var raw = await api(session, "POST", "scattergram-colleges-by-name", {
            class_of_years: CLASS_OF_YEARS, app_plan: [], collegeNid: Number(hit.nid), type: "sat", grading_type: "gpa",
            school_id: session.schoolId, student_uid: session.studentUid,
          });
          var norm = normalizeScatter(raw);
          if (!student && (norm.student.gpa || norm.student.sat)) student = norm.student;
          out.push({ slug: c.slug, maiaTitle: hit.title, averages: norm.averages, points: norm.points });
        } catch (e) {
          if (e.fatal) { send({ type: "cf-maia:error", error: e.message }); return; }
          missing.push({ slug: c.slug, name: c.name, reason: e.message || "Request failed" });
        }
        await sleep(DELAY_MS);
      }
      send({ type: "cf-maia:progress", done: colleges.length, total: colleges.length, name: "" });
      send({ type: "cf-maia:result", cancelled: cancelled, payload: { classOfYears: CLASS_OF_YEARS, student: student, colleges: out }, missing: missing });
    } finally {
      window.removeEventListener("message", onMessage);
    }
  }

  var started = false;
  function onMessage(event) {
    if (!current()) { window.removeEventListener("message", onMessage); return; }
    if (event.origin !== FORGE || event.source !== popup) return;
    var msg = event.data || {};
    if (msg.type === "cf-maia:hello" && !started && Array.isArray(msg.colleges)) {
      started = true;
      clearInterval(ping);
      var list = msg.colleges.filter(function (c) { return c && typeof c.slug === "string" && typeof c.name === "string"; }).slice(0, 200);
      run(list);
    } else if (msg.type === "cf-maia:cancel") {
      cancelled = true;
    }
  }
  window.addEventListener("message", onMessage);

  // The popup may still be loading; keep knocking until it answers.
  var tries = 0;
  var ping = setInterval(function () {
    if (started || popup.closed || ++tries > 60) { clearInterval(ping); return; }
    try { popup.postMessage({ type: "cf-maia:ping" }, FORGE); } catch (e) { /* popup not on Forge yet */ }
  }, 500);
})();
