const BASE = process.env.BASE || "http://127.0.0.1:3210";
for (const p of ["/api/ai/status", "/api/workspace"]) {
  const r = await fetch(`${BASE}${p}`);
  console.log(`${p} -> ${r.status}  cache-control: ${r.headers.get("cache-control")}`);
}
