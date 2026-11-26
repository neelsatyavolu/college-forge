const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const nav = require('../public/hub/nav.js');

test('the hub and the rankings page build their sidebars from the one list in nav.js', () => {
  assert.ok(nav.NAV.some((n) => n.id === 'list'));
  assert.ok(nav.PAGE_LINKS.some((n) => n.href === '/rankings'));
  for (const n of [...nav.NAV, ...nav.PAGE_LINKS]) {
    assert.ok(nav.GROUPS.includes(n.group), n.label);
    assert.ok(nav.ICONS[n.icon], n.label);
  }
  const html = read('public/hub/index.html');
  assert.ok(html.indexOf('./nav.js') > -1 && html.indexOf('./nav.js') < html.indexOf('./compiled/hub.js'));
  assert.match(read('public/hub/App.jsx'), /window\.cfNav/);
  const shell = read('app/rankings/WorkspaceShell.tsx');
  assert.match(shell, /from "@\/public\/hub\/nav\.js"/);
  // No hand-kept copy of the hub's tabs.
  assert.doesNotMatch(shell, /label: "Portals"/);
});
