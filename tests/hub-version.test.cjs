const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../scripts/hub-version.mjs');

test('local scripts and stylesheets get a version; external, root and icon URLs do not', async () => {
  const { stampAssetVersions } = await load();
  const html = [
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans" />',
    '<link rel="stylesheet" href="../../styles.css" />',
    '<link rel="stylesheet" href="./workspace.css" />',
    '<link rel="icon" href="/favicon.ico" />',
    '<script src="./compiled/hub.js" data-hub-sources="App.jsx"></script>',
    '<script src="../../_ds_bundle.js"></script>',
  ].join('\n');
  const out = stampAssetVersions(html, 'abc123');
  assert.match(out, /href="\.\.\/\.\.\/styles\.css\?v=abc123"/);
  assert.match(out, /href="\.\/workspace\.css\?v=abc123"/);
  assert.match(out, /src="\.\/compiled\/hub\.js\?v=abc123" data-hub-sources="App.jsx"/);
  assert.match(out, /src="\.\.\/\.\.\/_ds_bundle\.js\?v=abc123"/);
  assert.match(out, /href="https:\/\/fonts\.googleapis\.com\/css2\?family=DM\+Sans"/);
  assert.match(out, /href="\/favicon\.ico"/);
});

test('re-stamping replaces the old version and bad versions are rejected', async () => {
  const { stampAssetVersions } = await load();
  const once = stampAssetVersions('<script src="./api.js"></script>', 'v1');
  assert.equal(stampAssetVersions(once, 'v2'), '<script src="./api.js?v=v2"></script>');
  assert.throws(() => stampAssetVersions('', 'x" onload="alert(1)'));
});
