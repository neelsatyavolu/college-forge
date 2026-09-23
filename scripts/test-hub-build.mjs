import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

for (const [page, bundle] of [['index.html', 'hub.js'], ['share.html', 'share.js']]) {
  const html = await readFile(new URL('../public/hub/' + page, import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+(?:https?:|text\/babel)/, `${page} has no external scripts or runtime JSX compiler`);
  assert.match(html, new RegExp(`compiled/${bundle.replace('.', '\\.')}`));
  const js = await readFile(new URL('../public/hub/compiled/' + bundle, import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Script(js), `${bundle} is browser JavaScript`);
  assert.match(js, /ReactDOM.createRoot/, `${bundle} mounts its page`);
}
const hub = await readFile(new URL('../public/hub/compiled/hub.js', import.meta.url), 'utf8');
assert.match(hub, /window.Recommendations = Recommendations/);
assert.match(hub, /window.App = App/);
console.log('PASS local production assets, compiled JSX syntax, exports, and page mounting');
