const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const block = (src, name) => src.match(new RegExp(`const ${name}(?::[^=]+)? = \\[([\\s\\S]*?)\\];`))[1];
const entries = text => [...text.matchAll(/label: "([^"]+)", group: "([^"]+)"/g)].map(([, label, group]) => ({ label, group }));

test('the rankings sidebar lists the same tabs, in the same order, as the hub sidebar', () => {
  const hub = read('public/hub/App.jsx');
  const rankings = read('app/rankings/WorkspaceShell.tsx');
  const groups = ['Your workspace', 'Discover', 'Apply', 'Workspace'];
  const hubItems = [...entries(block(hub, 'NAV')), ...entries(block(hub, 'PAGE_LINKS'))];
  // The hub renders each group's hash views first, then that group's full-page links.
  const hubOrder = groups.flatMap(g => hubItems.filter(n => n.group === g).map(n => n.label));
  const rankingsNav = entries(block(rankings, 'NAV'));
  const rankingsOrder = groups.flatMap(g => rankingsNav.filter(n => n.group === g).map(n => n.label));
  assert.deepEqual(rankingsOrder, hubOrder);
});
