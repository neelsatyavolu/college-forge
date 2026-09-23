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
  assert.equal(collegeVineUrlFor(index, 'The Ohio State University', 'the-ohio-state-university'), url('ohio-state-university-osu'));
  assert.equal(collegeVineUrlFor(index, 'University of Michigan--Ann Arbor', 'x'), url('university-of-michigan'));
  assert.equal(collegeVineUrlFor(index, 'Nowhere College', 'nowhere-college'), url('nowhere-college'));
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
