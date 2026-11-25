// Live check of the onboarding interview with a real ChatGPT model, using this Mac's Codex CLI sign-in
// (~/.codex/auth.json; tokens stay in memory, are never refreshed or printed). A second model plays a
// synthetic student. Not part of `npm test`: it costs real model calls. Usage:
//   node scripts/test-onboarding-ai-live.mjs [maxTurns=40] [researchSchools=2]
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) + '.ts' : request, ...args); };

for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = /^(EXA_API_KEY|TINYFISH_API_KEY|FIRECRAWL_API_URL|FIRECRAWL_API_KEY)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'forge-live-onboarding-'));
process.env.CF_DATA_DIR = dataDir;
delete process.env.BLOB_READ_WRITE_TOKEN;

const store = require(path.join(root, 'lib/store.ts'));
const { runCodexChat } = require(path.join(root, 'lib/codex-client.ts'));
const { makeHubTools } = require(path.join(root, 'lib/hub-tools.ts'));
const { makeInterviewTools, recordTurn } = require(path.join(root, 'lib/interview-tools.ts'));
const { buildInterviewPrompt, RESEARCH_RULES } = require(path.join(root, 'lib/interview-prompt.ts'));
const { buildHubSystemPrompt } = require(path.join(root, 'lib/hub-context.ts'));
const { firstIncomplete } = require(path.join(root, 'lib/interview-checklist.ts'));
const { applyApprovedList } = require(path.join(root, 'lib/onboarding-list.ts'));
const { importCurated, researchSteps } = require(path.join(root, 'lib/research-plan.ts'));

const auth = JSON.parse(readFileSync(path.join(os.homedir(), '.codex/auth.json'), 'utf8')).tokens;
const exp = JSON.parse(Buffer.from(auth.access_token.split('.')[1], 'base64url').toString()).exp * 1000;
if (exp < Date.now() + 10 * 60_000) { console.error('The Codex CLI token expires soon; run `codex` once to refresh it, then retry.'); process.exit(2); }
const tokens = { accessToken: auth.access_token, refreshToken: auth.refresh_token, expiresAt: exp, accountId: auth.account_id };

const MAX_TURNS = Number(process.argv[2] || 40);
const RESEARCH_N = Number(process.argv[3] || 2);
const WS = 'live-onboarding';
const PERSONA = `You are Maya, a synthetic high-school senior (class of 2027) from Columbus, Ohio, at Westland High School (public). Unweighted GPA 3.86, weighted 4.31, 7 APs. SAT 1460 (one sitting). Activities: robotics team build lead (10 hrs/wk, 3 years), part-time at a bike repair shop (8 hrs/wk), tutors middle schoolers in math. Honors: AP Scholar with Distinction, regional science fair 2nd place. Wants to study mechanical engineering, maybe product design. Prefers suburban or college-town campuses, medium size, Midwest or Northeast. Family budget about $25k a year, will apply for need-based aid, interested in merit money. Would apply ED only if the aid works out ("maybe"). Balanced ambition. No transcript file handy. Answer the counselor naturally in 1-3 sentences, like a real teenager; if shown options, pick one by its label.`;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const mutate = (fn) => store.updateWorkspace(WS, fn);
const read = () => store.getWorkspace(WS);
const noop = () => {};

async function counselorTurn(history, mode = 'onboarding') {
  const ws = await read();
  const events = [];
  const hub = makeHubTools(WS, { userText: history.at(-1).content, draftStorageKey: ws.draftStorageKey });
  const iv = makeInterviewTools(mutate, read, (e) => events.push(e));
  const exec = async (name, args) => (await iv.execute(name, args)) ?? hub.executeTool(name, args);
  const calls = [];
  const result = await runCodexChat({
    tokens, instructions: mode === 'onboarding' ? buildInterviewPrompt(ws) : `${buildHubSystemPrompt(ws)}\n\n${RESEARCH_RULES}`,
    turns: history.slice(-16), emit: noop, tools: [...hub.tools, ...iv.tools],
    executeTool: async (n, a) => { calls.push(n); return exec(n, a); },
    shouldEndTurn: iv.endTurn, ...(mode === 'research' || ws.onboarding.interview?.phase === 'list' ? { maxRounds: 14 } : {}),
  });
  if (mode === 'onboarding') await mutate((w) => recordTurn(recordTurn(w, { role: 'user', content: history.at(-1).content, at: Date.now() }), { role: 'assistant', content: result.text, at: Date.now() }));
  return { text: result.text, events, calls, finish: result.finishReason };
}

async function studentReply(history, ui) {
  const shown = ui?.question ? `\n[Shown as ${ui.question.kind}${ui.question.options ? ': ' + ui.question.options.map((o) => o.label).join(' | ') : ''}${ui.question.min != null ? ` (${ui.question.min}-${ui.question.max})` : ''}]` : '';
  const turns = history.slice(-10).map((t) => ({ role: t.role === 'user' ? 'assistant' : 'user', content: t.content || '(tiles)' }));
  turns[turns.length - 1] = { ...turns.at(-1), content: turns.at(-1).content + shown };
  const r = await runCodexChat({ tokens, instructions: PERSONA, turns, emit: noop, tools: [], executeTool: async () => '' });
  return r.text.trim() || 'Sure.';
}

try {
  await mutate((w) => ({ ...w, onboarding: { completed: false, interview: { phase: 'interview', section: 'basics', transcript: [], notes: {}, deep: [], startedAt: Date.now() } } }));
  const history = [{ role: 'user', content: "Hi! I'm ready to set up Forge." }];
  let listShown = null, turnCount = 0, problems = [];
  while (turnCount++ < MAX_TURNS) {
    const t0 = Date.now();
    const r = await counselorTurn(history);
    const ui = r.events.find((e) => e.type === 'question') ? { question: r.events.find((e) => e.type === 'question').question } : null;
    const list = r.events.find((e) => e.type === 'list');
    log(`turn ${turnCount} ${((Date.now() - t0) / 1000).toFixed(0)}s [${r.calls.join(',')}] finish=${r.finish}`);
    log('  AI:', r.text.replace(/\s+/g, ' ').slice(0, 220), ui ? `<${ui.question.kind}: ${ui.question.prompt}>` : '');
    if (!r.text.trim() && !ui && !list) problems.push(`turn ${turnCount}: empty reply`);
    history.push({ role: 'assistant', content: r.text });
    if (list) { listShown = list.schools; break; }
    const nowIv = (await read()).onboarding.interview;
    if (nowIv.phase === 'list' && !(nowIv.listDraft || []).length) { history.push({ role: 'user', content: 'Show me my draft college list.' }); log('  (client) Show me my draft college list.'); continue; }
    const answer = await studentReply(history, ui);
    log('  Maya:', answer.slice(0, 200));
    history.push({ role: 'user', content: answer });
  }
  const ws = await read();
  log('checklist first gap:', firstIncomplete(ws), '| deep answers:', ws.onboarding.interview.deep.length, '| activities:', ws.profile.activities.length);
  log('profile:', JSON.stringify({ name: ws.applicant.name, gpa: ws.applicant.gpaUnweighted, sat: ws.profile.testing.sat, intended: ws.profile.intended, residency: ws.profile.residency, prefs: ws.onboarding.listPrefs }));
  if (!listShown) { console.error('No list was proposed within', MAX_TURNS, 'turns.', problems); process.exit(1); }
  log('LIST:', listShown.map((s) => `${s.tier}: ${s.name} (${s.netPrice || '?'}, fits ${s.fitsBudget || '?'})`).join(' | '));

  // Approve the whole list, then research the first few schools for real.
  const approved = applyApprovedList(await read(), listShown.map((s) => s.name), []);
  if (approved.error) throw new Error(approved.error);
  await mutate(() => importCurated(approved));
  const steps = researchSteps(await read()).slice(0, RESEARCH_N);
  for (const step of steps) {
    const t0 = Date.now();
    const r = await counselorTurn([{ role: 'user', content: step.prompt }], 'research');
    const c = (await read()).colleges.find((x) => x.slug === step.slug);
    log(`research ${step.name} ${((Date.now() - t0) / 1000).toFixed(0)}s calls=${r.calls.length} facts=${c.research?.facts.length ?? 0} complete=${c.research?.complete} deadlines=${(c.deadlines || []).map((d) => d.plan + ' ' + d.date).join(', ')}`);
    for (const f of (c.research?.facts || []).slice(0, 6)) log(`   ${f.key}: ${f.value.slice(0, 90)} (${f.cycle}${f.thirdParty ? ', 3P' : ''})`);
  }
  // Strategy.
  const s = await counselorTurn([...history.slice(-4), { role: 'user', content: 'Research is done. Recommend my early application plan.' }]);
  const strat = s.events.find((e) => e.type === 'strategy');
  log('STRATEGY:', strat ? JSON.stringify(strat.strategy).slice(0, 400) : `(none) ${s.text.slice(0, 200)}`);
  if (problems.length) log('problems:', problems);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
