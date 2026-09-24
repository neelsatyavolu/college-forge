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

  // Positive integer ids only: Maia uses "0" as a placeholder (e.g. iec_school).
  function findId(value, keys) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return String(value);
    if (typeof value === "string" && /^[1-9]\d{0,11}$/.test(value.trim())) return value.trim();
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

  /** Decode a stored blob that may be JSON or base64-encoded JSON. */
  function decodeBlob(raw) {
    if (typeof raw !== "string" || !raw) return null;
    var v = parseStored(raw);
    if (v && typeof v === "object") return v;
    try {
      var b = atob(raw.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
      var j = JSON.parse(b);
      return j && typeof j === "object" ? j : null;
    } catch (e) { return null; }
  }

  /** Depth-first search for a numeric id under any key matching `pattern`; returns { id, path }. */
  function deepFindId(value, pattern, path, depth) {
    if (!value || typeof value !== "object" || (depth || 0) > 4) return null;
    var keys = Object.keys(value).slice(0, 200);
    for (var i = 0; i < keys.length; i++) {
      if (pattern.test(keys[i])) {
        var hit = findId(value[keys[i]], SCHOOL_KEYS);
        if (hit) return { id: hit, path: path + keys[i] };
      }
    }
    for (var j = 0; j < keys.length; j++) {
      var nested = deepFindId(value[keys[j]], pattern, path + keys[j] + ".", (depth || 0) + 1);
      if (nested) return nested;
    }
    return null;
  }

  /**
   * Candidate school ids, best first. Maia is Drupal-based: the stored profile's
   * user.og_user_node.und lists the organic groups (schools) the student belongs
   * to. Explicit school_id/school_nid fields are the fallback.
   */
  function schoolCandidates(profile, claims) {
    var out = [];
    function add(id, path) { if (id && !out.some(function (c) { return c.id === id; })) out.push({ id: id, path: path }); }
    var groups = profile && profile.user && profile.user.og_user_node && profile.user.og_user_node.und;
    (Array.isArray(groups) ? groups : []).slice(0, 10).forEach(function (g, i) {
      add(findId(g, ["target_id", "nid", "gid", "id"]), "userToken:user.og_user_node.und." + i);
    });
    [{ name: "userToken", value: profile }, { name: "token", value: claims }].forEach(function (s) {
      var hit = deepFindId(s.value, /school_?(nid|id)$/i, s.name + ":");
      if (hit) add(hit.id, hit.path);
    });
    return out;
  }

  /** Read the session the Maia app itself uses. `storage` is a Storage-like object. */
  function readSession(storage) {
    var token = findJwt(parseStored(storage.getItem("userAccessKey"))) || findJwt(parseStored(storage.getItem("userToken")));
    if (!token) {
      for (var i = 0; i < storage.length && !token; i++) token = findJwt(parseStored(storage.getItem(storage.key(i))));
    }
    var claims = token ? jwtClaims(token) : {};
    var profile = decodeBlob(storage.getItem("userToken"));
    var selSchool = findId(parseStored(storage.getItem("sel_school")), SCHOOL_KEYS);
    var schools = (selSchool ? [{ id: selSchool, path: "sel_school" }] : []).concat(schoolCandidates(profile, claims).filter(function (c) { return c.id !== selSchool; }));
    var selUser = findId(parseStored(storage.getItem("sel_user")), USER_KEYS);
    var claimUser = selUser ? null : ["uid", "user_id", "userId", "sub"].filter(function (k) { return findId(claims[k], []); })[0];
    var profileUser = findId(profile && profile.user && profile.user.uid, []);
    return {
      token: token,
      schools: schools,
      schoolId: schools.length ? schools[0].id : null,
      studentUid: selUser || (claimUser ? findId(claims[claimUser], []) : profileUser),
      sources: { school: schools.length ? schools[0].path : null, student: selUser ? "sel_user" : claimUser ? "token:" + claimUser : profileUser ? "userToken:user.uid" : null },
    };
  }

  /** Field paths with types (and whether the value is all digits), never values. */
  function fieldShapes(value, prefix, depth, out) {
    out = out || [];
    if (!value || typeof value !== "object" || depth > 2) return out;
    Object.keys(value).slice(0, 40).forEach(function (f) {
      if (out.length >= 60) return;
      var v = value[f];
      var t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
      out.push((prefix + f).slice(0, 60) + ":" + t + (/^\d+$/.test(String(v)) ? "(digits)" : ""));
      if (t === "object") fieldShapes(v, prefix + f + ".", depth + 1, out);
    });
    return out;
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
      if (v && typeof v === "object" && !Array.isArray(v)) shape.fields = fieldShapes(v, "", 0);
      var jwt = findJwt(v);
      if (jwt) shape.claims = fieldShapes(jwtClaims(jwt), "", 0);
      else if (typeof v === "string" && raw.length > 40) {
        var blob = decodeBlob(raw);
        shape.decoded = blob ? "base64-json" : "opaque";
        if (blob) shape.fields = fieldShapes(blob, "", 0);
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
      var call = path.split("/")[0];
      if (!res.ok) {
        return res.text().catch(function () { return ""; }).then(function (t) {
          var detail = String(t || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
          throw Object.assign(new Error("Maia returned " + res.status + " on " + call + (detail ? ": " + detail : "")), { signature: res.status + " " + call });
        });
      }
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
      var idsUsed = { schools: session.schools.map(function (s) { return s.id + " from " + s.path; }), studentUid: session.studentUid, studentFrom: session.sources.student };
      var streak = { signature: null, count: 0 };
      var schoolIdx = 0;
      for (var i = 0; i < colleges.length && active(); i++) {
        var c = colleges[i];
        send({ type: "cf-maia:progress", done: i, total: colleges.length, name: c.name });
        try {
          var hit = await collegeNid(session, c);
          if (!hit) { missing.push({ slug: c.slug, name: c.name, reason: "Not found in Maia" }); continue; }
          var raw = await api(session, "POST", "scattergram-colleges-by-name", {
            class_of_years: CLASS_OF_YEARS, app_plan: [], collegeNid: Number(hit.nid), type: "sat", grading_type: "gpa",
            school_id: session.schools[schoolIdx].id, student_uid: session.studentUid,
          });
          var norm = normalizeScatter(raw);
          if (!student && (norm.student.gpa || norm.student.sat)) student = norm.student;
          out.push({ slug: c.slug, maiaTitle: hit.title, averages: norm.averages, points: norm.points });
          streak = { signature: null, count: 0 };
        } catch (e) {
          if (e.fatal) { send({ type: "cf-maia:error", error: e.message }); return; }
          // "Not authorized for this school": the id was wrong, so try the next candidate on the same college.
          if (e.signature === "406 scattergram-colleges-by-name" && schoolIdx < session.schools.length - 1) {
            schoolIdx++;
            i--;
            await sleep(DELAY_MS);
            continue;
          }
          missing.push({ slug: c.slug, name: c.name, reason: e.message || "Request failed" });
          // The same failure three times in a row is systematic: stop instead of hammering Maia.
          streak = e.signature && e.signature === streak.signature ? { signature: e.signature, count: streak.count + 1 } : { signature: e.signature || null, count: 1 };
          if (streak.count >= 3) {
            send({ type: "cf-maia:error", error: "Stopped: " + e.message, diagnostic: [idsUsed].concat(describeStorage(localStorage)) });
            return;
          }
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
      var list = msg.colleges.filter(function (c) { return c && typeof c.slug === "string" && typeof c.name === "string"; }).slice(0, 300);
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
