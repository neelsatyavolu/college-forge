import assert from 'node:assert/strict';
const base=process.env.BASE || 'http://127.0.0.1:3210';
const initial=await fetch(base+'/api/workspace');
assert.equal(initial.status,200);
const cookie=initial.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'fresh isolated test workspace');
const before=await initial.json();
const patches=[
 ...Array.from({length:20},(_,i)=>({plannerToggle:{key:`concurrency-check-${i}`,done:true}})),
 ...Array.from({length:5},(_,i)=>({essayDraft:{id:`concurrency-draft-${i}`,text:`Synthetic draft ${i}`}})),
 {profile:{intended:'Biology'}}, {financialAid:{cssStatus:'in_progress'}},
];
const responses=await Promise.all(patches.map(patch=>fetch(base+'/api/workspace',{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(patch)})));
console.log('Save statuses:', responses.reduce((counts,response)=>({...counts,[response.status]:(counts[response.status]||0)+1}),{}));
assert.ok(responses.every(response=>response.status===200),'all saves succeed');
const saved=await Promise.all(responses.map(response=>response.json()));
const current=await (await fetch(base+'/api/workspace',{headers:{cookie}})).json();
assert.equal(Object.keys(current.plannerDone).length,20);assert.equal(Object.keys(current.essayDrafts).length,5);
assert.equal(current.profile.intended,'Biology');assert.equal(current.financialAid.cssStatus,'in_progress');
assert.equal(current.revision,before.revision+patches.length);
assert.equal(new Set(saved.map(result=>result.data.revision)).size,patches.length);
console.log(`PASS ${patches.length} simultaneous local API saves retained, with unique revisions and no lost drafts`);
