const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const Module=require('node:module');
const ts=require('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const {getWorkspace,updateWorkspace,emptyWorkspace,resetWorkspace,saveUpload}=require('../lib/store.ts');
async function withDirectory(run){
 const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'forge-concurrency-'));
 const priorDir=process.env.CF_DATA_DIR,priorBlob=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.CF_DATA_DIR=directory;delete process.env.BLOB_READ_WRITE_TOKEN;
 try{await run(directory);}finally{
  if(priorDir===undefined)delete process.env.CF_DATA_DIR;else process.env.CF_DATA_DIR=priorDir;
  if(priorBlob===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=priorBlob;
  await fs.promises.rm(directory,{recursive:true,force:true});
 }
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('parallel first reads share one persistent namespace',async()=>withDirectory(async()=>{
 const workspaces=await Promise.all(Array.from({length:20},()=>getWorkspace('new')));
 assert.equal(new Set(workspaces.map(ws=>ws.draftStorageKey)).size,1);
}));
test('many simultaneous async mutations keep every independent patch',async()=>withDirectory(async()=>{
 assert.equal(typeof updateWorkspace,'function','Atomic update API must exist');
 const returned=await Promise.all(Array.from({length:35},(_,index)=>updateWorkspace('parallel',async ws=>{
  await delay(2);return {...ws,essayDrafts:{...ws.essayDrafts,['essay-'+index]:'Draft '+index},applicant:{...ws.applicant,awards:ws.applicant.awards+1}};
 })));
 const ws=await getWorkspace('parallel');assert.equal(ws.applicant.awards,35);assert.equal(Object.keys(ws.essayDrafts).length,35);
 assert.equal(ws.revision,35);assert.deepEqual(returned.map(value=>value.revision).sort((a,b)=>a-b),Array.from({length:35},(_,i)=>i+1));
}));
test('independent Node processes serialize the same local workspace',async()=>withDirectory(async directory=>{
 assert.equal(typeof updateWorkspace,'function');
 const script=`const fs=require('node:fs'),ts=require('typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true,resolveJsonModule:true}}).outputText,f);const {updateWorkspace}=require('./lib/store.ts');(async()=>{for(let i=0;i<12;i++)await updateWorkspace('processes',async ws=>{await new Promise(r=>setTimeout(r,2));return {...ws,essayDrafts:{...ws.essayDrafts,[process.env.WRITER+'-'+i]:'saved'},applicant:{...ws.applicant,awards:ws.applicant.awards+1}};});})().catch(e=>{console.error(e);process.exitCode=1;});`;
 await Promise.all(Array.from({length:4},(_,index)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),env:{...process.env,CF_DATA_DIR:directory,WRITER:String(index)},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>{error+=chunk;});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error||'Child failed '+code)));
 })));
 const ws=await getWorkspace('processes');assert.equal(ws.applicant.awards,48);assert.equal(Object.keys(ws.essayDrafts).length,48);
}));
test('mutation and atomic rename failures preserve existing data and release the lock',async t=>withDirectory(async directory=>{
 assert.equal(typeof updateWorkspace,'function');
 const original=await updateWorkspace('failure',ws=>({...ws,essayDrafts:{one:'Keep me'}}));
 const file=path.join(directory,'workspaces','failure.json');const bytes=await fs.promises.readFile(file,'utf8');
 await assert.rejects(updateWorkspace('failure',()=>{throw Error('Mutation rejected');}),/Mutation rejected/);
 const rename=t.mock.method(fs.promises,'rename',async()=>{throw Error('Rename failed');});
 try{await assert.rejects(updateWorkspace('failure',ws=>({...ws,essayDrafts:{one:'Lose me'}})),/Rename failed/);}finally{rename.mock.restore();}
 assert.equal(await fs.promises.readFile(file,'utf8'),bytes);
 assert.deepEqual((await getWorkspace('failure')).essayDrafts,original.essayDrafts);
 assert.deepEqual((await fs.promises.readdir(path.dirname(file))).sort(),['failure.json']);
 await updateWorkspace('failure',ws=>({...ws,essayDrafts:{...ws.essayDrafts,two:'Later'}}));
}));
test('an existing local lock times out without stealing it or modifying data',async()=>withDirectory(async directory=>{
 assert.equal(typeof updateWorkspace,'function');await getWorkspace('locked');
 const file=path.join(directory,'workspaces','locked.json'),lock=file+'.lock';const bytes=await fs.promises.readFile(file,'utf8');
 await fs.promises.writeFile(lock,'another writer');const start=Date.now();
 await assert.rejects(updateWorkspace('locked',ws=>({...ws,essayDrafts:{bad:'write'}})),/busy|lock|timed out/i);
 assert.ok(Date.now()-start<10000,'Lock waiting must be bounded');
 assert.equal(await fs.promises.readFile(file,'utf8'),bytes);assert.equal(await fs.promises.readFile(lock,'utf8'),'another writer');
}));
async function withBlob(run){
 const prior=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN='test-only';const originalLoad=Module._load;
 class BlobError extends Error{};class BlobPreconditionFailedError extends BlobError{};
 const state={raw:null,version:0,writes:[],reads:0,conflicts:0,alwaysConflict:false,serviceError:false,weakByDefault:false,alwaysWeak:false,externalMode:null};
 const sdk={BlobError,BlobPreconditionFailedError,
  get:async(key,options)=>{assert.equal(options.useCache,false);state.reads++;if(state.serviceError)throw Error('Service down');const raw=state.raw,version=state.version;await delay(1);return raw===null?null:{statusCode:200,stream:new Response(raw).body,blob:{etag:((state.alwaysWeak || (state.weakByDefault && options.headers?.['accept-encoding']!=='identity')) ? 'W/' : '')+'\"v'+version+'\"'}};},
  put:async(key,raw,options)=>{state.writes.push(options);await delay(1);
   if(state.externalMode){const mode=state.externalMode;state.externalMode=null;const other=state.raw===null?emptyWorkspace():JSON.parse(state.raw);other.essayDrafts.external='Other process';other.revision++;state.raw=JSON.stringify(other);state.version++;
    if(mode==='operation')throw new BlobError('Vercel Blob: The conditional request cannot succeed due to a conflicting operation against this resource.');
    if(mode==='create')throw new BlobError('This blob already exists, use allowOverwrite: true');
    throw new BlobPreconditionFailedError('conflict');
   }
   if(state.alwaysConflict)throw new BlobPreconditionFailedError('conflict');
   if(options.allowOverwrite===false && state.raw!==null){state.conflicts++;throw new BlobError('This blob already exists, use allowOverwrite: true');}
   if(options.ifMatch && options.ifMatch!=='\"v'+state.version+'\"'){state.conflicts++;throw new BlobPreconditionFailedError('conflict');}
   if(state.raw!==null)assert.ok(options.ifMatch,'Existing blobs must always use CAS');else assert.equal(options.allowOverwrite,false,'New blobs must be create-only');
   state.raw=raw;state.version++;return {etag:'\"v'+state.version+'\"'};
  }};
 Module._load=function(request,...args){return request==='@vercel/blob'?sdk:originalLoad.call(this,request,...args);};
 try{await run(state);}finally{Module._load=originalLoad;if(prior===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=prior;}
}
test('Blob same-process parallel updates queue without a conditional-write stampede',async()=>withBlob(async state=>{
 assert.equal(typeof updateWorkspace,'function');
 const returned=await Promise.all(Array.from({length:12},(_,i)=>updateWorkspace('blob',ws=>({...ws,essayDrafts:{...ws.essayDrafts,['draft-'+i]:'saved'},applicant:{...ws.applicant,awards:ws.applicant.awards+1}}))));
 const saved=JSON.parse(state.raw);assert.equal(saved.applicant.awards,12);assert.equal(Object.keys(saved.essayDrafts).length,12);assert.equal(state.conflicts,0);assert.equal(saved.revision,12);assert.deepEqual(returned.map(ws=>ws.revision).sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));assert.equal(new Set(returned.map(ws=>ws.draftStorageKey)).size,1);
}));
test('Blob migration cannot overwrite a simultaneous user edit',async()=>withBlob(async state=>{
 const legacy=emptyWorkspace();delete legacy.draftStorageKey;state.raw=JSON.stringify(legacy);state.version=1;
 const [first,updated]=await Promise.all([getWorkspace('legacy'),updateWorkspace('legacy',ws=>({...ws,essayDrafts:{...ws.essayDrafts,one:'Concurrent edit'}}))]);
 const saved=JSON.parse(state.raw);assert.equal(saved.essayDrafts.one,'Concurrent edit');assert.equal(first.draftStorageKey,saved.draftStorageKey);assert.equal(updated.draftStorageKey,saved.draftStorageKey);
}));
test('Blob retry limit and service failures preserve the original content',async()=>withBlob(async state=>{
 assert.equal(typeof updateWorkspace,'function');state.raw=JSON.stringify(emptyWorkspace());state.version=1;const before=state.raw;
 state.alwaysConflict=true;await assert.rejects(updateWorkspace('busy',ws=>({...ws,essayDrafts:{one:'Change'}})),/conflict|busy|retry/i);assert.equal(state.raw,before);assert.ok(state.writes.length<=20);
 state.alwaysConflict=false;state.serviceError=true;const writes=state.writes.length;await assert.rejects(updateWorkspace('error',ws=>ws),/Service down/);assert.equal(state.writes.length,writes);
}));
test('concurrent uploads merge metadata and reset receives a new draft namespace',async()=>withDirectory(async()=>{
 const initial=await getWorkspace('uploads');
 await Promise.all(Array.from({length:10},(_,i)=>saveUpload('uploads','file-'+i+'.txt','text')));
 assert.equal((await getWorkspace('uploads')).uploads.length,10);
 const reset=await resetWorkspace('uploads');assert.equal(reset.uploads.length,0);assert.notEqual(reset.draftStorageKey,initial.draftStorageKey);
}));

test('Blob JSON reads request identity encoding so compressed weak ETags cannot break CAS',async()=>withBlob(async state=>{
 state.raw=JSON.stringify(emptyWorkspace());state.version=1;state.weakByDefault=true;
 const saved=await updateWorkspace('json',ws=>({...ws,essayDrafts:{one:'A realistic JSON essay draft'.repeat(300)}}));
 assert.equal(saved.revision,1);assert.equal(state.writes.length,1);assert.equal(state.writes[0].ifMatch,'"v1"');
}));
test('unexpected weak ETags fail clearly before writes or conflict retries',async()=>withBlob(async state=>{
 state.raw=JSON.stringify(emptyWorkspace());state.version=1;state.alwaysWeak=true;
 await assert.rejects(updateWorkspace('weak',ws=>({...ws,essayDrafts:{one:'Draft'}})),/weak ETag/i);
 assert.equal(state.writes.length,0);
}));

test('Blob retries external create, ETag, and conditional-operation conflicts against freshly read data',async()=>withBlob(async state=>{
 for(const mode of ['create','cas','operation']){
   state.raw=mode==='create'?null:JSON.stringify(emptyWorkspace());state.version=1;state.externalMode=mode;state.writes=[];
   let calls=0;
   const saved=await updateWorkspace('external-'+mode,ws=>{calls++;return {...ws,essayDrafts:{...ws.essayDrafts,mine:'My update'}};});
   assert.equal(calls,2);assert.equal(saved.essayDrafts.external,'Other process');assert.equal(saved.essayDrafts.mine,'My update');assert.equal(saved.revision,2);assert.equal(state.writes.length,2);
 }
}));
test('queue releases after a rejected mutation and unrelated workspaces do not block each other',async()=>withDirectory(async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const entered=[];
 const first=updateWorkspace('queued',async ws=>{entered.push('first');await gate;throw Error('First update failed');}).catch(error=>error);
 while(!entered.includes('first'))await delay(1);
 const second=updateWorkspace('queued',ws=>{entered.push('second');return {...ws,essayDrafts:{second:'Saved'}};});
 try{
   const unrelated=await updateWorkspace('other',ws=>({...ws,essayDrafts:{other:'Saved in parallel'}}));
   assert.equal(unrelated.essayDrafts.other,'Saved in parallel');assert.equal(entered.includes('second'),false);
 }finally{release();}
 assert.match((await first).message,/First update failed/);assert.equal((await second).essayDrafts.second,'Saved');
 const third=await updateWorkspace('queued',ws=>({...ws,essayDrafts:{...ws.essayDrafts,third:'Also saved'}}));
 assert.equal(third.essayDrafts.second,'Saved');assert.equal(third.essayDrafts.third,'Also saved');
}));
