// Asset-level checks for a deployment: no mock data shipped, fonts wired, css fixes live.
const BASE = process.env.BASE || "http://127.0.0.1:3210";
let fail = 0;
const ok = (c, label) => { console.log(`${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fail = 1; };

const bundle = await (await fetch(`${BASE}/_ds_bundle.js`)).text();
console.log(`      bundle size: ${(bundle.length / 1024).toFixed(1)} KB`);
ok(!/Northwestern University|Riverside High|Nenu AI/.test(bundle), "no mock college data shipped in bundle");
ok(!/window\.(App|CF_DATA|AiChat|Overview) = /.test(bundle), "no mock app/data globals in bundle");
ok(/__ds_ns\.TopBar = __ds_scope\.TopBar/.test(bundle), "design-system components still exported");

const html = await (await fetch(`${BASE}/hub/index.html`)).text();
ok(html.includes("fonts.gstatic.com") && html.includes("family=DM+Sans"), "font preconnect + stylesheet in <head>");
ok(html.includes('content="light dark"'), "color-scheme meta present");

ok(!/<script[^>]+(?:https?:|text\/babel)/.test(html), "no external JS dependency or runtime JSX compiler");
for (const asset of ["hub.js", "share.js", "react.production.min.js", "react-dom.production.min.js"]) {
  const response = await fetch(`${BASE}/hub/compiled/${asset}`);
  ok(response.status === 200 && (await response.text()).length > 100, `compiled/${asset} available`);
}

const css = await (await fetch(`${BASE}/styles.css`)).text();
ok(/button, input, textarea, select \{\s*font-family: inherit/.test(css), "form controls inherit body font");
ok(css.includes('[data-theme="dark"]'), "css includes designed dark theme");
ok(css.includes(":focus-visible"), "focus ring only for keyboard nav");
ok(!css.includes("@import url(\"https://fonts"), "render-blocking @import removed");

const data = await (await fetch(`${BASE}/hub/data.js`)).text();
ok(!/Northwestern|Stanford University/.test(data), "data.js has no seeded colleges");

process.exit(fail);
