import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  for (const path of ['node_modules/react/umd/react.development.js', 'node_modules/react-dom/umd/react-dom.development.js']) await page.addScriptTag({ content: readFileSync(path, 'utf8') });
  await page.evaluate(() => {
    const wrapper = ({ children }) => React.createElement('div', {}, children);
    window.CollegeForgeDesignSystem_e95e63 = { StatCard: wrapper, Badge: wrapper, VerdictBadge: wrapper, SectionLabel: wrapper, Tile: wrapper, Button: ({ children, variant, size, ...props }) => React.createElement('button', props, children) };
    window.saves = [];
    window.testData = { applicant: {name: 'Test student'}, profile: { testing: {sat:'—', satNote:'Test optional — not submitting', aps:[]}, coursework: {honors:['English'], aps:[], senior:[]}, activities: [{rank:1, name:'Robotics', type:'Club', org:'School team', role:'Captain', years:'10–12', hpw:'4', wpy:'30', college:true, desc:'Built a robot.', bullets:['Led five teammates']}], honors: [{title:'Regional finalist', level:'Regional', year:'2026', top:true}] } };
    window.cfApi = { patch: async patch => { if (window.failSave) throw Error('Connection lost. Try again.'); window.saves.push(patch); return window.testData; } };
    window.root = ReactDOM.createRoot(document.getElementById('root'));
  });
  await page.addScriptTag({ content: '(function(){' + ts.transpile(readFileSync('public/hub/Profile.jsx', 'utf8'), { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 }) + '})();' });
  await page.evaluate(() => root.render(React.createElement(window.Profile, {data: window.testData})));
  const click = async text => { await page.waitForFunction(text => [...document.querySelectorAll('button')].some(button => button.textContent === text && !button.disabled), {}, text); await page.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent === text).click(), text); };
  await page.waitForSelector('button');
  await click('Edit profile');
  await page.waitForSelector('fieldset');
  assert.ok(!(await page.evaluate(() => document.body.textContent)).includes('JSON'));
  await click('Save profile');
  await page.waitForFunction(() => window.saves.length === 1);
  const patch = await page.evaluate(() => window.saves[0]);
  assert.deepEqual(patch.profile.activities[0], {rank:1,name:'Robotics',type:'Club',org:'School team',role:'Captain',years:'10–12',hpw:'4',wpy:'30',college:true,desc:'Built a robot.',bullets:['Led five teammates']});
  assert.deepEqual(patch.profile.honors[0], {title:'Regional finalist',level:'Regional',year:'2026',top:true});
  assert.deepEqual(patch.profile.coursework.honors, ['English']);
  await click('Edit profile');
  await click('+ Add activity');
  await click('Save profile');
  await page.waitForFunction(() => document.body.innerText.includes('Give activity 2 a name'));
  assert.equal(await page.evaluate(() => window.saves.length), 1);
  await click('Remove activity 2');
  await click('+ Add AP score');
  await click('Save profile');
  await page.waitForFunction(() => document.body.innerText.includes('AP exam 1 needs a course name'));
  const fillLabel = async (label, value) => {
    const input = await page.evaluateHandle(label => [...document.querySelectorAll('label')].find(el => el.textContent.includes(label)).querySelector('input,textarea'), label);
    await input.type(value);
  };
  await fillLabel('AP course', 'Calculus AB');
  await fillLabel('Score (1–5)', '5');
  await page.evaluate(() => window.failSave = true);
  await click('Save profile');
  await page.waitForFunction(() => document.body.innerText.includes('Connection lost. Try again.'));
  assert.ok(await page.$('fieldset'), 'Save errors must retain the editor');
  await page.evaluate(() => window.failSave = false);
  await click('Save profile');
  await page.waitForFunction(() => window.saves.length === 2);
  assert.deepEqual(await page.evaluate(() => window.saves[1].profile.testing.aps), [{course:'Calculus AB',score:'5'}]);
  await click('Edit profile');
  const replaceAcademic = async (label, value) => {
    const input = await page.evaluateHandle(label => [...document.querySelectorAll('label')].find(element => element.firstElementChild?.textContent === label).querySelector('input'), label);
    await input.evaluate(element => { element.focus(); element.select(); }); await input.press('Backspace'); if (value) await input.type(value);
  };
  for (const [label, value, message] of [
    ['GPA unweighted','4.8','Unweighted GPA'], ['GPA unweighted','-0.1','Unweighted GPA'], ['GPA unweighted','abc','Unweighted GPA'],
    ['GPA weighted','6.1','Weighted GPA'], ['GPA weighted','NaN','Weighted GPA'],
    ['SAT','9999','SAT'], ['SAT','399','SAT'], ['SAT','1200.5','SAT'], ['SAT','test optional','SAT'],
    ['Grad year','20x7','Graduation year'], ['Grad year','20270','Graduation year'], ['Grad year','1899','Graduation year'], ['Grad year','2101','Graduation year'],
  ]) {
    await replaceAcademic(label,value);
    await click('Save profile');
    await page.waitForFunction(message => window.saves.length > 2 || document.querySelector('[role="alert"]')?.textContent.includes(message), {}, message);
    assert.equal(await page.evaluate(() => window.saves.length),2,`${label} ${value} must not be saved`);
    assert.ok((await page.$eval('[role="alert"]',element=>element.textContent)).includes(message));
    await replaceAcademic(label,'');
  }
  for (const [label,value] of [['GPA unweighted','0'],['GPA weighted','6'],['SAT','400'],['Grad year','1900']]) await replaceAcademic(label,value);
  await click('Save profile'); await page.waitForFunction(()=>window.saves.length===3);
  const lower = await page.evaluate(()=>window.saves[2]);
  assert.equal(lower.applicant.gpaUnweighted,'0');assert.equal(lower.applicant.gpaWeighted,'6');assert.equal(lower.profile.testing.sat,'400');assert.equal(lower.profile.gradYear,'1900');
  assert.equal(lower.profile.testing.satNote,'Test optional — not submitting','Academic validation must preserve the test-optional note');
  await click('Edit profile');
  for (const [label,value] of [['GPA unweighted','4'],['GPA weighted','0'],['SAT','1600'],['Grad year','2100']]) await replaceAcademic(label,value);
  await click('Save profile');await page.waitForFunction(()=>window.saves.length===4);
  assert.equal(await page.evaluate(()=>window.saves[3].applicant.gpaWeighted),'0');assert.equal(await page.evaluate(()=>window.saves[3].profile.testing.sat),'1600');
  await click('Edit profile');
  for(const label of ['GPA unweighted','GPA weighted','SAT','Grad year']) await replaceAcademic(label,'  ');
  await click('Save profile');await page.waitForFunction(()=>window.saves.length===5);
  const empty=await page.evaluate(()=>window.saves[4]);
  assert.equal(empty.applicant.gpaWeighted,'—');assert.equal(empty.applicant.gpaUnweighted,'—');assert.equal(empty.profile.testing.sat,'—');assert.equal(empty.profile.gradYear,'');
  assert.equal(empty.profile.testing.satNote,'Test optional — not submitting');
  await click('Edit profile');
  for (let index = 1; index < 10; index++) await click('+ Add activity');
  for (let index = 1; index < 5; index++) await click('+ Add honor');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === '+ Add activity').disabled), true);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === '+ Add honor').disabled), true);
  await page.setViewport({width:375,height:812});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Profile editor must fit a mobile viewport');
  console.log('Profile editor: fields preserved, blank entries rejected, AP scores saved, failed-save draft retained, GPA/SAT/year bounds validated, optional blanks and test-optional notes preserved, limits enforced, mobile layout fits.');
} finally { await browser.close(); }
