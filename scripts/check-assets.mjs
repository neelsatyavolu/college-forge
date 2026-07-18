// Asset-level checks for a deployment: no mock data shipped, fonts wired, css fixes live.
const BASE = process.env.BASE || "https://college-forge.vercel.app";
let fail = 0;
const ok = (c, label) => { console.log(`${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fail = 1; };

const bundle = await (await fetch(`${BASE}/_ds_bundle.js`)).text();
console.log(`      bundle size: ${(bundle.length / 1024).toFixed(1)} KB`);
ok(!/Northwestern University|Riverside High|Nenu AI/.test(bundle), "no mock college data shipped in bundle");
ok(!/window\.(App|CF_DATA|AiChat|Overview) = /.test(bundle), "no mock app/data globals in bundle");
ok(/__ds_ns\.TopBar = __ds_scope\.TopBar/.test(bundle), "design-system components still exported");

const html = await (await fetch(`${BASE}/hub/index.html`)).text();
ok(html.includes("fonts.gstatic.com") && html.includes("family=Inter"), "font preconnect + stylesheet in <head>");
ok(html.includes('content="only light"'), "color-scheme meta present");

const css = await (await fetch(`${BASE}/styles.css`)).text();
ok(/button, input, textarea, select \{\s*font-family: inherit/.test(css), "form controls inherit body font");
ok(css.includes("color-scheme: only light"), "css opts out of auto-dark");
ok(css.includes(":focus-visible"), "focus ring only for keyboard nav");
ok(!css.includes("@import url(\"https://fonts"), "render-blocking @import removed");

const data = await (await fetch(`${BASE}/hub/data.js`)).text();
ok(!/Northwestern|Stanford University/.test(data), "data.js has no seeded colleges");

process.exit(fail);
