const test = require('node:test');
const assert = require('node:assert/strict');

const load = (name) => import(`../scripts/supplements/${name}.mjs`);

const page = (body) => `<html><head><title>Essays</title></head><body><nav><a href="/x">Why us?</a></nav><main>${body}</main><footer><p>What is your email? 10 words</p></footer></body></html>`;

test('parseLimit reads word and character limits in common phrasings', async () => {
  const { parseLimit } = await load('extract');
  assert.deepEqual(parseLimit('(Please respond in 250 words or fewer.)'), { limit: 250, unit: 'words' });
  assert.deepEqual(parseLimit('no more than 200 characters'), { limit: 200, unit: 'characters' });
  assert.deepEqual(parseLimit('a 1,200-word essay'), { limit: 1200, unit: 'words' });
  assert.deepEqual(parseLimit('100-250 words'), { limit: 250, unit: 'words' });
  assert.equal(parseLimit('Class of 2031'), null);
  assert.equal(parseLimit('3 words'), null);
});

test('intro limits apply to following questions; nav, footer and duplicates are ignored', async () => {
  const { extractPrompts } = await load('extract');
  const { prompts } = extractPrompts(page(`
    <h2>Your Voice</h2>
    <p>Princeton has a longstanding commitment to service. How does your own story intersect with these ideals? (Please respond in 250 words or fewer.)</p>
    <h2>More About You</h2>
    <p>Please respond to each question in 50 words or fewer.</p>
    <ul><li>What brings you joy?</li><li>What song represents the soundtrack of your life?</li></ul>
    <p>What brings you joy?</p>`));
  assert.equal(prompts.length, 3);
  assert.deepEqual(prompts.map((p) => [p.label, p.limit, p.unit]), [
    ['Your Voice', 250, 'words'],
    ['More About You 1', 50, 'words'],
    ['More About You 2', 50, 'words'],
  ]);
});

test('choose-one sections become one prompt with options; past, transfer and credit lines are skipped', async () => {
  const { extractPrompts } = await load('extract');
  const { prompts, cycle } = extractPrompts(page(`
    <p>Introducing the 2026-2027 essay prompts.</p>
    <h3>Question 1 (Required)</h3>
    <p>How does the University satisfy your desire for a particular kind of learning, community, and future?</p>
    <h3>Question 2: Extended Essay (Required; Choose one)</h3>
    <p>Food for thought: How do thoughts eat?</p>
    <p>Inspired by Ernest Leong, Class of 2026</p>
    <p>The Olympics have long celebrated the pinnacle of human athletic achievement. Imagine a new event.</p>
    <h3>Past Essay Prompts</h3>
    <p>How did you get caught? (Or not caught, as the case may be.) 300 words</p>
    <h3>Transfer applicants</h3>
    <p>Why are you transferring? Please respond in 500 words.</p>`));
  assert.equal(cycle, '2026-27');
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].limit, null);
  assert.equal(prompts[1].label, 'Question 2: Extended Essay (Required; Choose one)');
  assert.equal(prompts[1].options.length, 2);
  assert.ok(prompts.every((p) => !/caught|transferring/.test(p.prompt + p.options.join(' '))));
});

test('optional prompts are marked and pages without prompts yield nothing', async () => {
  const { extractPrompts } = await load('extract');
  const optional = extractPrompts(page('<h3>Optional short answer</h3><p>Tell us about something you are excited about. (150 words)</p>'));
  assert.equal(optional.prompts[0].required, false);
  const faq = extractPrompts(page('<h2>Required Materials</h2><p>Every avenue to our school is unique. Please find the documents you need.</p>'));
  assert.equal(faq.prompts.length, 0);
});

test('section state follows heading levels (review regressions)', async () => {
  const { extractPrompts } = await load('extract');
  const labels = (body) => extractPrompts(page(body)).prompts.map((p) => [p.label, p.limit, p.options.length]);
  // Subheadings inside a skipped archive stay skipped.
  assert.deepEqual(labels('<h2>Past essay prompts</h2><h3>Question 1</h3><p>Why do you want to attend? (250 words)</p><h2>Current</h2><h3>Question 1</h3><p>Describe a community you belong to. (200 words)</p>'), [['Question 1', 200, 0]]);
  // An intro limit carries across per-question subheadings.
  assert.deepEqual(labels('<h2>Short answers</h2><p>Please respond to each of the following in 50 words or fewer.</p><h3>Intellectual life</h3><p>What is a question you want answered?</p><h3>Community</h3><p>Describe a tradition you cherish.</p>'), [['Intellectual life', 50, 0], ['Community', 50, 0]]);
  // Short prompts with an inline limit, prompts ending "below (N words)", collapsed panels, and div text all count.
  assert.deepEqual(labels('<h2>Why us</h2><p>Why do you want to attend? (250 words)</p>'), [['Why us', 250, 0]]);
  assert.deepEqual(labels('<h2>Essay</h2><p>Tell us about an experience in the space below. (250 words)</p>'), [['Essay', 250, 0]]);
  assert.deepEqual(labels('<h2>Essays</h2><div aria-hidden="true"><p>Why Us? Tell us why you want to attend. (250 words)</p></div>'), [['Essays', 250, 0]]);
  assert.deepEqual(labels('<h2>Essay</h2><div>Why do you want to study here? (200 words)<p>Note: responses are read by faculty.</p></div>'), [['Essay', 200, 0]]);
  // Logistics after a choose-one list are not options.
  const group = extractPrompts(page('<h2>Essay</h2><p>Choose one of the following prompts (300 words).</p><p>Describe a time you changed your mind about something important.</p><p>Tell us about a book that shaped how you see the world.</p><p>All applicants must also submit two letters of recommendation from teachers.</p>')).prompts;
  assert.equal(group.length, 1);
  assert.equal(group[0].options.length, 2);
});

test('isLimitOnly separates bare limit lines from short prompts', async () => {
  const { isLimitOnly } = await load('extract');
  assert.equal(isLimitOnly('250 words'), true);
  assert.equal(isLimitOnly('(Maximum 150 words)'), true);
  assert.equal(isLimitOnly('Why do you want to attend? (250 words)'), false);
});

test('CollegeVine cards parse label, badge, limit, split paragraphs and options', async () => {
  const { parseCollegeVine } = await load('collegevine');
  const html = `<h1>Yale University</h1><h1>Yale University’s 2024-25 Essay&nbsp;Prompts</h1>
    <div class="card-body p-5"><h3>Why This Major Short Response</h3><span class="badge"><div>Required</div></span>
      <span class="text-secondary ml-2">200 Words</span><p class="fw-bold"><p>First paragraph.</p><p>Second paragraph?</p></p></div>
    <div class="card-body p-5"><h3>Select-A-Prompt Essay</h3><span class="badge"><div>Optional</div></span>
      <span class="text-secondary ml-2">400 Characters</span><p class="fw-bold"><p>Respond to one.</p></p>
      <hr><div class="row"><div class="col-12"><h5>Option 1</h5><p><p>What inspires you?</p></p></div></div></div>
    <div class="card-body p-5"><h3>Graded Paper</h3><span class="text-secondary ml-2">2 Pages</span><p><p>Upload a paper.</p></p></div>`;
  const { cycle, prompts } = parseCollegeVine(html);
  assert.equal(cycle, '2024-25');
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].prompt, 'First paragraph.\n\nSecond paragraph?');
  assert.deepEqual([prompts[1].unit, prompts[1].required, prompts[1].options], ['characters', false, ['What inspires you?']]);
});

test('CollegeVine pages are matched by name and the no-essays notice is detected', async () => {
  const { collegeVineUrlFor, parseCollegeVine } = await load('collegevine');
  const { nameKey } = await load('discover');
  const url = (s) => `https://www.collegevine.com/schools/${s}/essay-prompts`;
  const index = new Map(['ohio-state-university-osu', 'university-of-michigan', 'university-of-michigan-dearborn-um-dearborn'].map((s) => [nameKey(s.replace(/-/g, ' ')), url(s)]));
  assert.equal(collegeVineUrlFor(index, 'The Ohio State University', 'the-ohio-state-university').url, url('ohio-state-university-osu'));
  assert.equal(collegeVineUrlFor(index, 'University of Michigan--Ann Arbor', 'x').url, url('university-of-michigan'));
  assert.equal(collegeVineUrlFor(index, 'Nowhere College', 'nowhere-college').url, url('nowhere-college'));
  const none = parseCollegeVine('<title>FIU’s 2024-25 Essay Prompts | CollegeVine</title><h1>Florida International University | FIU</h1><p>This school does not require essays or the essay prompts are not available yet.</p>');
  assert.deepEqual([none.cycle, none.prompts.length, none.noEssays], ['2024-25', 0, true]);
});

test('robots.txt: wildcard rules match precisely and the longest rule wins', async () => {
  const { parseRobots, robotsAllows } = await load('http');
  const rules = parseRobots('User-agent: Other\nDisallow: /\n\nUser-agent: *\nAllow: /core/*.css$\nDisallow: /*?\nDisallow: /admin\nAllow: /admin/public');
  assert.equal(robotsAllows(rules, '/'), true);
  assert.equal(robotsAllows(rules, '/apply/essays'), true);
  assert.equal(robotsAllows(rules, '/apply?page=2'), false);
  assert.equal(robotsAllows(rules, '/admin/x'), false);
  assert.equal(robotsAllows(rules, '/admin/public/x'), true);
});

test('discovery ranks same-site essay links and matches Common App names', async () => {
  const { rankLinks, nameVariants, commonAppHome, nameKey } = await load('discover');
  const links = rankLinks(
    '<a href="/apply/essays">Essay prompts</a><a href="/apply/">Apply</a><a href="/transfer/essays">Transfer essays</a><a href="https://other.edu/essays">Essays</a><a href="/news">News</a>',
    'https://admission.example.edu/'
  );
  const undergrad = rankLinks('<a href="/admissions/undergraduate/essays">Essays</a>', 'https://www.example.edu/');
  assert.equal(undergrad[0].score, 2);
  assert.deepEqual(links.filter((l) => l.score > 0).map((l) => [l.url, l.score]), [
    ['https://admission.example.edu/apply/essays', 2],
    ['https://admission.example.edu/apply/', 1],
  ]);
  const index = new Map([[nameKey('University of Michigan'), 'https://umich.example/'], [nameKey('University of Texas at Austin'), 'https://utexas.example/']]);
  assert.ok(nameVariants('University of Michigan--Ann Arbor').includes('university michigan'));
  assert.equal(commonAppHome(index, 'University of Michigan--Ann Arbor'), 'https://umich.example/');
  assert.equal(commonAppHome(index, 'The University of Texas--Austin'), 'https://utexas.example/');
});

test('client-rendered shells are detected for headless rendering', async () => {
  const { needsRender } = await load('render');
  assert.equal(needsRender('<div id="___gatsby"></div><link href="/a.css">'), true);
  assert.equal(needsRender('<a href="/1">1</a><a href="/2">2</a><a href="/3">3</a><a href="/4">4</a><a href="/5">5</a>'), false);
});

test('currentCycle rolls over in July', async () => {
  const { currentCycle } = await import('../scripts/fetch-supplements.mjs');
  assert.equal(currentCycle(new Date('2026-09-23T00:00:00Z')), '2026-27');
  assert.equal(currentCycle(new Date('2027-03-01T00:00:00Z')), '2026-27');
  assert.equal(currentCycle(new Date('2099-07-01T00:00:00Z')), '2099-00');
});

const fixture = (name) => require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/supplements', `${name}.html`), 'utf8');
const shape = (prompts) => prompts.map((p) => [p.label, p.limit, p.required, p.audience ?? null]);

test('UT Austin: instruction lines are not prompts', async () => {
  const { extractPrompts } = await load('extract');
  assert.deepEqual(shape(extractPrompts(fixture('ut-austin')).prompts), [
    ['Required Prompts 1', 300, true, null],
    ['Required Prompts 2', 300, true, null],
    ['Optional Prompt', 300, false, null],
  ]);
});

test('Georgetown: labelled essays are kept, the personal-statement note is dropped, school essays get an audience', async () => {
  const { extractPrompts } = await load('extract');
  const { prompts } = extractPrompts(fixture('georgetown'));
  assert.deepEqual(shape(prompts), [
    ['Short Essay 1', 250, true, null],
    ['Short Essay 2', 250, true, null],
    ['Essay 1', 650, true, null],
    ['Essay 2: College of Arts & Sciences', 500, false, 'College of Arts & Sciences'],
    ['Essay 2: Berkley School of Nursing', 500, false, 'Berkley School of Nursing'],
    ['Essay 2: School of Health', 500, false, 'School of Health'],
  ]);
  assert.match(prompts[0].prompt, /^Briefly discuss/);
  assert.match(prompts[4].prompt, /^Describe the factors/);
});

test('Princeton: A.B. and B.S.E. prompts are for one group each', async () => {
  const { extractPrompts } = await load('extract');
  assert.deepEqual(shape(extractPrompts(fixture('princeton')).prompts), [
    ['For A.B. Degree Applicants or Those Who Are Undecided', 250, false, 'A.B. Degree Applicants or Those Who Are Undecided'],
    ['For B.S.E Degree Applicants', 250, false, 'B.S.E Degree Applicants'],
    ['Your Voice', 250, true, null],
    ['More About You 1', 50, true, null],
    ['More About You 2', 50, true, null],
  ]);
});

test('Tufts: per-school prompts get an audience, the AI notice is dropped, and the class year sets the cycle', async () => {
  const { extractPrompts } = await load('extract');
  const { prompts, cycle } = extractPrompts(fixture('tufts'));
  assert.equal(cycle, '2026-27');
  assert.deepEqual(shape(prompts), [
    ['Short Answer Prompt #1', 150, true, null],
    ['Short Answer Prompts for the Class of 2031: School of Arts and Sciences', 200, false, 'School of Arts and Sciences'],
    ['Short Answer Prompts for the Class of 2031: School of Engineering', 200, false, 'School of Engineering'],
  ]);
});

test('FAQ headings are not used as labels', async () => {
  const { extractPrompts } = await load('extract');
  const { prompts } = extractPrompts(page('<h2>What is included in the supplement?</h2><p>Please respond to each question in 150 words or fewer.</p><ul><li>How will your life experiences shape what you contribute?</li><li>What do you hope to do in the future?</li></ul>'));
  assert.deepEqual(prompts.map((p) => p.label), ['Short answer 1', 'Short answer 2']);
});

test('detectCycle prefers a stated range and otherwise reads the entering class', async () => {
  const { detectCycle } = await load('extract');
  assert.equal(detectCycle('Essay prompts for 2026-2027 · Class of 2026 alumni'), '2026-27');
  assert.equal(detectCycle('Questions for the Class of 2031'), '2026-27');
  assert.equal(detectCycle('Fall 2027 application'), '2026-27');
  assert.equal(detectCycle('Welcome'), null);
  const nov2026 = new Date('2026-11-01T00:00:00Z');
  assert.equal(detectCycle('Applying for Fall 2027. Test policy changes for Fall 2028.', nov2026), '2026-27');
  assert.equal(detectCycle('Fall 2028 only', nov2026), null);
});

test('CollegeVine: Texas A&M does not resolve to Texarkana, abbreviations still match', async () => {
  const { collegeVineUrlFor, collegeVinePageMatches } = await load('collegevine');
  const { nameKey } = await load('discover');
  const url = (s) => `https://www.collegevine.com/schools/${s}/essay-prompts`;
  const index = new Map(['texas-a-and-m-university-texarkana', 'florida-state-university-fsu', 'university-of-massachusetts-global', 'the-university-of-texas-at-tyler'].map((s) => [nameKey(s.replace(/-/g, ' ')), url(s)]));
  const tamu = collegeVineUrlFor(index, 'Texas A&M University', 'texas-a-and-m-university');
  assert.deepEqual(tamu, { url: url('texas-a-and-m-university'), exact: false });
  assert.deepEqual(collegeVineUrlFor(index, 'Florida State University', 'fsu'), { url: url('florida-state-university-fsu'), exact: true });
  assert.equal(collegeVineUrlFor(index, 'University of Massachusetts--Amherst', 'umass').url, url('umass'));
  assert.equal(collegeVineUrlFor(index, 'The University of Texas--Dallas', 'utd').url, url('utd'));
  assert.equal(collegeVinePageMatches('Texas A&M University-Texarkana', 'Texas A&M University'), false);
  assert.equal(collegeVinePageMatches('Florida State University | FSU', 'Florida State University'), true);
  assert.equal(collegeVinePageMatches('University of Michigan', 'University of Michigan--Ann Arbor'), true);
  assert.equal(collegeVinePageMatches('University of Massachusetts Global', 'University of Massachusetts--Amherst'), false);
});

test('fetcher covers national universities plus the top 30 liberal arts colleges', async () => {
  const { collegesFromRankings, LAC_TOP, allRequiredMany } = await import('../scripts/fetch-supplements.mjs');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../lib/us-news-rankings.ts'), 'utf8');
  const colleges = collegesFromRankings(src);
  const lac = colleges.filter((c) => c.list === 'liberal-arts');
  assert.ok(lac.length >= LAC_TOP && lac.every((c) => c.rank <= LAC_TOP && c.scorecardId));
  assert.ok(lac.some((c) => c.slug === 'williams-college'));
  assert.equal(new Set(colleges.map((c) => c.slug)).size, colleges.length);
  const req = (n) => Array.from({ length: n }, () => ({ required: true }));
  assert.equal(allRequiredMany(req(5)), true);
  assert.equal(allRequiredMany(req(4)), false);
  assert.equal(allRequiredMany([...req(4), { required: false }]), false);
});

test('dataset covers every top-100 national university and top-30 liberal arts college', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { collegesFromRankings, currentCycle } = await import('../scripts/fetch-supplements.mjs');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/supplements/prompts.json'), 'utf8'));
  const colleges = collegesFromRankings(fs.readFileSync(path.join(__dirname, '../lib/us-news-rankings.ts'), 'utf8'))
    .filter((c) => (c.list === 'national' ? c.rank <= 100 : c.rank <= 30))
    .filter((c) => !c.slug.startsWith('university-of-california-'));
  const missing = colleges.filter((c) => !data.schools[c.slug]).map((c) => c.slug);
  assert.deepEqual(missing, []);
  const tamu = data.schools['texas-a-and-m-university'];
  assert.ok(!/texarkana/.test(tamu.url || ''), 'Texas A&M must not use the Texarkana page');
  const top100 = colleges.filter((c) => c.list === 'national');
  // Older than this cycle: a stated past cycle. Pages with no year are flagged in the app instead.
  const cycle = currentCycle(new Date(data.generatedAt));
  const stale = top100.filter((c) => data.schools[c.slug].source !== 'none' && data.schools[c.slug].cycle && data.schools[c.slug].cycle < cycle);
  assert.ok(stale.length <= top100.length * 0.25, `${stale.length} of ${top100.length} top-100 entries are not from the current cycle: ${stale.map((c) => c.slug).join(', ')}`);
});

test('hand-copied prompts apply only to the cycle they were copied for', async () => {
  const { copiedPrompts } = await import('../scripts/fetch-supplements.mjs');
  const reg = { url: 'https://admissions.example.edu/essays', cycle: '2026-27', prompts: [{ label: 'Why us', prompt: 'Why do you want to attend?', limit: 250 }] };
  const entry = copiedPrompts(reg, '2026-27');
  assert.equal(entry.source, 'official');
  assert.deepEqual(entry.prompts[0], { unit: 'words', required: true, options: [], label: 'Why us', prompt: 'Why do you want to attend?', limit: 250 });
  assert.equal(copiedPrompts(reg, '2027-28'), null);
  assert.equal(copiedPrompts({ url: reg.url }, '2026-27'), null);
});

test('notes about the application itself are not saved as prompts', async () => {
  const { extractPrompts } = await load('extract');
  const blog = extractPrompts(page(`<h2>What's new</h2>
    <p>We know that many rising seniors are eager to know the details about our application process; today's post should be helpful to those students as they plan and prepare to click the submit button.</p>
    <p>Our application opens on August 1. We accept both the Common Application and the Coalition Application. The process is the same, no matter which platform you choose.</p>
    <h3>Why us</h3><p>Tell us why you want to attend. (100 words)</p>`)).prompts;
  assert.deepEqual(blog.map((p) => p.label), ['Why us']);
  const notes = extractPrompts(page(`<h3>Instructions</h3><p>Some programs may have other specific requirements. Check your desired program's page or speak with an admission counselor to confirm you have the needed materials. (250 words)</p>`)).prompts;
  assert.deepEqual(notes, []);
});

test('a CollegeVine card whose only text above its options is a heading keeps just the options', async () => {
  const { parseCollegeVine } = await load('collegevine');
  const html = `<html><head><title>Sample College's 2024-25 Essay Prompts</title></head><body><h1>Sample College</h1><h1>2024-25 Essay Prompts</h1>
    <div class="card-body"><h3>Select-A-Prompt Short Response</h3><span class="text-secondary">400 words</span><span class="badge">Required</span>
    <p>Additional Information</p>
    <div><h5>Option 1</h5><p>What social issue would you make the focus of your work?</p></div>
    <div><h5>Option 2</h5><p>What drew you to our programs?</p></div></div></body></html>`;
  const [p] = parseCollegeVine(html).prompts;
  assert.equal(p.prompt, '');
  assert.equal(p.options.length, 2);
});

test('the dataset has no application notes or bare headings saved as prompts', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/supplements/prompts.json'), 'utf8'));
  const NOTE = /\b(?:today[’']s post|this post|application opens|we accept both|speak with an admissions? counselor|other specific requirements)\b/i;
  const bad = [];
  for (const [slug, school] of Object.entries(data.schools)) {
    for (const p of school.prompts || []) {
      if (/^instructions?$/i.test(p.label.trim())) bad.push(`${slug}: label "${p.label}"`);
      if (NOTE.test(p.prompt) && !p.prompt.includes('?')) bad.push(`${slug}: "${p.prompt.slice(0, 60)}"`);
      if (p.options?.length && /^additional information$/i.test(p.prompt.trim())) bad.push(`${slug}: bare heading "${p.prompt}"`);
    }
  }
  assert.deepEqual(bad, []);
});
