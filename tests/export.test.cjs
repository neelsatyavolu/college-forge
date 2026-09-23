const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true}}).outputText,file);
const {exportPlainText,exportCalendar,exportCounselorBrief} = require('../lib/export.ts');
const workspace = () => ({draftStorageKey:'export-test-namespace',applicant:{name:'Test student',gpaWeighted:'4.1',gpaUnweighted:'3.8',sat:'1400'},profile:{gradYear:2027,activities:[],honors:[]},essays:{commonApp:[{id:'one',label:'First essay',prompt:'First prompt',limit:650,unit:'words',starter:'Starter to erase'},{id:'two',label:'Chosen essay',prompt:'Second prompt',limit:650,unit:'words'}],supplements:{school:[{id:'supp',label:'School supplement',prompt:'Supplement prompt',limit:250,unit:'words'}]}},essayDrafts:{one:'',two:'My current chosen essay.',supp:'School answer.'},colleges:[],criticalDates:[],applications:{},recommendations:[],scholarships:[]});
test('chosen personal statement exports exactly its saved draft while retaining supplements',()=>{
 const text=exportPlainText(workspace(),'two'); assert.match(text,/My current chosen essay\./);assert.match(text,/School answer\./);assert.doesNotMatch(text,/First prompt|Starter to erase/);
});
test('intentionally erased saved draft never resurrects starter text',()=>{
 const text=exportPlainText(workspace());assert.doesNotMatch(text,/Starter to erase/);assert.match(text,/\(empty draft\)/);
});
test('calendar validates actual dates and derives missing years from graduation cycle',()=>{
 const ws=workspace();ws.criticalDates=[{date:'Nov 1',label:'Fall deadline'},{date:'January 5',label:'Spring deadline'},{date:'2026-02-30',label:'Impossible ISO'},{date:'Feb 29, 2027',label:'Impossible named'},{date:'2028-02-29',label:'Leap deadline'},{date:'Rolling',label:'Unknown'}];
 const calendar=exportCalendar(ws);assert.equal(calendar.included,3);assert.equal(calendar.skipped,3);assert.match(calendar.text,/DTSTART;VALUE=DATE:20261101/);assert.match(calendar.text,/DTSTART;VALUE=DATE:20270105/);assert.match(calendar.text,/DTSTART;VALUE=DATE:20280229/);assert.doesNotMatch(calendar.text,/Impossible|Unknown/);
});
test('calendar never invents a year without a graduation year',()=>{
 const ws=workspace();ws.profile.gradYear='';ws.criticalDates=[{date:'Nov 1',label:'Unknown year'},{date:'2026-11-01',label:'Explicit year'}];const result=exportCalendar(ws);assert.equal(result.included,1);assert.equal(result.skipped,1);
});
test('calendar content escapes line breaks, folds UTF-8 safely and keeps stable event IDs',()=>{
 const ws=workspace();ws.criticalDates=[{date:'Nov 1',label:'College, deadline; '+ '🪴'.repeat(50),detail:'First line\r\nSecond line'},{date:'Jan 5',label:'Second'}];
 const first=exportCalendar(ws).text;assert.ok(first.endsWith('\r\n'));for(const line of first.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);assert.ok(!first.includes('\ufffd'));assert.match(first.replace(/\r\n /g,''),/DESCRIPTION:First line\\nSecond line/);
 const ids=first.match(/^UID:.*$/gm).sort();ws.criticalDates.reverse();assert.deepEqual(exportCalendar(ws).text.match(/^UID:.*$/gm).sort(),ids);
});
test('counselor brief includes schools with unknown tiers and uses likely terminology',()=>{
 const ws=workspace();ws.colleges=[{slug:'likely',name:'Likely school',tier:'safety'},{slug:'unknown',name:'Unassessed school'}];const brief=exportCounselorBrief(ws);assert.match(brief,/### Likely/);assert.match(brief,/Unassessed school/);assert.doesNotMatch(brief,/Safetys/);
});
