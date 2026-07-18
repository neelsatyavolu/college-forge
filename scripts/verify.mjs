// End-to-end smoke test of the hub server.
// Defaults to the local server; pass BASE=https://… to test a deployment.
const BASE = process.env.BASE || "http://127.0.0.1:3210";
let cookie = "";

async function hit(pathname, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + pathname, { ...opts, headers, redirect: "manual" });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return res;
}

function ok(cond, label) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

const root = await hit("/");
ok([307, 308, 302, 301].includes(root.status) && (root.headers.get("location") || "").includes("/hub/index.html"),
  `/ redirects to hub (status ${root.status} -> ${root.headers.get("location")})`);

const html = await hit("/hub/index.html");
const htmlText = await html.text();
ok(html.status === 200 && htmlText.includes("College Forge"), "GET /hub/index.html renders");
ok(htmlText.includes("./App.jsx") && htmlText.includes("../../_ds_bundle.js"), "index.html references app + bundle");

for (const p of ["/styles.css", "/_ds_bundle.js", "/hub/App.jsx", "/hub/AiChat.jsx", "/hub/data.js", "/assets/mark.svg"]) {
  const r = await hit(p);
  ok(r.status === 200, `GET ${p} (${r.status})`);
}

const wsRes = await hit("/api/workspace");
const ws = await wsRes.json();
ok(wsRes.status === 200 && Array.isArray(ws.colleges) && ws.colleges.length === 0, "GET /api/workspace returns empty workspace");
ok(ws.essays && Array.isArray(ws.essays.commonApp) && ws.ed === null, "workspace has empty shape (no mock data)");

const status = await (await hit("/api/ai/status")).json();
ok(typeof status.grokConnected === "boolean" && typeof status.codexConnected === "boolean", "GET /api/ai/status returns provider flags");
console.log(`      providers: grok=${status.grokConnected} codex=${status.codexConnected} opencode=${status.opencodeAvailable} active=${status.active}`);

// Upload a text file, then confirm it lands in the workspace uploads.
const fd = new FormData();
fd.append("files", new Blob(["GPA: 3.94 unweighted, 4.28 weighted. SAT 1540. Activity: Robotics captain."], { type: "text/plain" }), "resume.txt");
const up = await hit("/api/upload", { method: "POST", body: fd });
const upJson = await up.json();
ok(up.status === 200 && upJson.saved && upJson.saved.length === 1 && upJson.saved[0].chars > 0, "POST /api/upload stores extracted text");

const ws2 = await (await hit("/api/workspace")).json();
ok(ws2.uploads.some((u) => u.name === "resume.txt"), "uploaded file appears in workspace.uploads");

// Chat with no provider connected should stream a clean error (not crash).
const chat = await hit("/api/ai/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
});
const chatText = await chat.text();
ok(chat.status === 200 && chatText.includes("error") && /provider/i.test(chatText), "POST /api/ai/chat streams provider-needed error (no crash)");

console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
