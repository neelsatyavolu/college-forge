import { readFile, writeFile, mkdir, copyFile, readdir, rename } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import ts from 'typescript';
import { stampAssetVersions } from './hub-version.mjs';

const require = createRequire(import.meta.url);
const hub = fileURLToPath(new URL('../public/hub/', import.meta.url));
const output = join(hub, 'compiled');
// The hub loads React as script globals. React 19 ships no UMD builds, so the hub
// keeps React 18.3.1 from vendor/ while the Next.js pages use React 19.
const vendorReact = fileURLToPath(new URL('../vendor/react-18.3.1/', import.meta.url));
async function buildHub() {
  await mkdir(output, { recursive: true });

  for (const name of ['react', 'react-dom']) {
    const source = join(vendorReact, `${name}.production.min.js`);
    await copyFile(source, join(output, `${name}.production.min.js.tmp`));
    await rename(join(output, `${name}.production.min.js.tmp`), join(output, `${name}.production.min.js`));
  }

  for (const [page, bundle] of [['index.html', 'hub.js'], ['share.html', 'share.js']]) {
    const html = await readFile(join(hub, page), 'utf8');
    // Source order stays beside the bundle's script tag in the HTML entry point.
    const manifest = html.match(/data-hub-sources="([^"]+)"/);
    if (!manifest) throw new Error(`${page}: missing data-hub-sources`);
    const sources = manifest[1].trim().split(/\s+/);
    const chunks = [];
    for (const source of sources) {
      if (!/^[A-Za-z0-9_-]+\.jsx$/.test(source)) throw new Error(`Invalid hub source: ${source}`);
      const compiled = ts.transpileModule(await readFile(join(hub, source), 'utf8'), {
        fileName: source,
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React, removeComments: false },
        reportDiagnostics: true,
      });
      const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
      if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: () => hub, getCanonicalFileName: file => file, getNewLine: () => '\n',
      }));
      // Each source owns local names such as Button and Panel. Shared components
      // retain their explicit window exports, which other modules resolve globally.
      chunks.push(`// ${source}\n(() => {\n${compiled.outputText}\n})();`);
    }
    if (bundle === 'hub.js') chunks.push('ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(window.App));');
    const code = chunks.join('\n\n') + '\n';
    new Script(code, { filename: bundle });
    await writeFile(join(output, `${bundle}.tmp`), code);
    await rename(join(output, `${bundle}.tmp`), join(output, bundle));
    console.log(`Built ${bundle}: ${sources.length} modules, ${Math.round(Buffer.byteLength(code) / 1024)} KB`);
  }
}

await buildHub();

// Vercel builds only (local builds keep the tracked HTML unchanged): give each
// deploy fresh asset URLs so browsers never pair old hub code with a new API.
if (process.env.VERCEL) {
  const version = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || String(Date.now())).slice(0, 12);
  for (const page of ['index.html', 'share.html', 'maia-import.html']) {
    const file = join(hub, page);
    await writeFile(file, stampAssetVersions(await readFile(file, 'utf8'), version));
  }
  console.log(`Stamped hub asset URLs with ?v=${version}`);
}

if (process.argv.includes('--watch') || process.argv.includes('--dev')) {
  let timer;
  let queue = Promise.resolve();
  const watched = new Set();
  function changed() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      queue = queue.then(async () => { await buildHub(); await watchSources(); })
        .catch(error => console.error('Hub build failed:', error.message));
    }, 100);
  }
  async function watchSources() {
    for (const name of await readdir(hub)) {
      if (!/\.(jsx|html)$/.test(name) || watched.has(name)) continue;
      watched.add(name);
      // Poll a small source set: works with constrained native watcher limits.
      watchFile(join(hub, name), { interval: 500 }, changed);
    }
  }
  await watchSources();
  console.log('Watching hub JSX and HTML for changes');
  const next = process.argv.includes('--dev')
    ? spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...process.argv.slice(process.argv.indexOf('--dev') + 1)], { stdio: 'inherit' })
    : null;
  function cleanup() { for (const name of watched) unwatchFile(join(hub, name)); clearTimeout(timer); }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    cleanup();
    if (next) next.kill(signal); else process.exit(0);
  });
  next?.on('exit', code => { cleanup(); process.exit(code ?? 0); });
}
