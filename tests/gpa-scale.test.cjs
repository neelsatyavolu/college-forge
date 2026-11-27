const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const { parseApplicantFields } = require('../lib/profile-fields.ts');
const { buildInterviewPrompt } = require('../lib/interview-prompt.ts');
const { buildHubSystemPrompt, snapshot } = require('../lib/hub-context.ts');

test('the grading scale is saved with the GPA', () => {
  const r = parseApplicantFields({ gpaUnweighted: '3.85', gpaScale: '4.33' }, 'tool');
  assert.equal(r.ok, true);
  assert.equal(r.value.gpaScale, '4.33');
});

test('a 100-point or 4.33-scale number is not accepted as unweighted', () => {
  assert.equal(parseApplicantFields({ gpaUnweighted: '92' }, 'tool').ok, false);
  assert.equal(parseApplicantFields({ gpaUnweighted: '4.2' }, 'tool').ok, false);
});

test('the interview and the copilot both check the scale', () => {
  const ws = emptyWorkspace();
  ws.applicant.gpaUnweighted = '3.8';
  for (const prompt of [buildInterviewPrompt(ws), buildHubSystemPrompt(ws)]) {
    assert.match(prompt, /Grading scales: before saving any GPA/);
    assert.match(prompt, /Never scale proportionally/);
  }
  assert.match(snapshot(ws), /scale=—/);
});
