const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const {getWorkspace,emptyWorkspace} = require('../lib/store.ts');
async function withDirectory(run) {
 const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'forge-storage-'));
 const priorDir=process.env.CF_DATA_DIR, priorBlob=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.CF_DATA_DIR=directory;delete process.env.BLOB_READ_WRITE_TOKEN;
 await fs.promises.mkdir(path.join(directory,'workspaces'));
 try {await run(directory);} finally {
   if(priorDir===undefined)delete process.env.CF_DATA_DIR;else process.env.CF_DATA_DIR=priorDir;
   if(priorBlob===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=priorBlob;
   await fs.promises.rm(directory,{recursive:true,force:true});
 }
}
test('a transient read error cannot replace an existing workspace with empty data',async t=>withDirectory(async directory=>{
 const file=path.join(directory,'workspaces','existing.json');
 const original=JSON.stringify({...emptyWorkspace(),applicant:{name:'Keep this student'}});
 await fs.promises.writeFile(file,original);
 const read=fs.promises.readFile;
 const mocked=t.mock.method(fs.promises,'readFile',async (...args)=>{if(args[0]===file)throw Object.assign(new Error('Temporary read failure'),{code:'EIO'});return read(...args);});
 try {await assert.rejects(getWorkspace('existing'),/Temporary read failure/);}finally{mocked.mock.restore();}
 assert.equal(await fs.promises.readFile(file,'utf8'),original);
}));
test('malformed and empty JSON are errors and stay unchanged',async()=>withDirectory(async directory=>{
 const file=path.join(directory,'workspaces','broken.json');
 for(const text of ['{broken','']){
   await fs.promises.writeFile(file,text);
   await assert.rejects(getWorkspace('broken'),/JSON|workspace/i);
   assert.equal(await fs.promises.readFile(file,'utf8'),text);
 }
}));
test('directory read errors never attempt a write',async t=>withDirectory(async directory=>{
 const file=path.join(directory,'workspaces','directory.json');await fs.promises.mkdir(file);
 const spy=t.mock.method(fs.promises,'writeFile');
 try {await assert.rejects(getWorkspace('directory'));assert.equal(spy.mock.callCount(),0);}finally{spy.mock.restore();}
 assert.ok((await fs.promises.stat(file)).isDirectory());
}));
test('confirmed missing workspaces and legacy key migrations persist a stable draft namespace',async()=>withDirectory(async directory=>{
 const first=await getWorkspace('new');const second=await getWorkspace('new');
 assert.equal(first.draftStorageKey,second.draftStorageKey);
 const legacy=emptyWorkspace();delete legacy.draftStorageKey;legacy.applicant.name='Legacy student';
 await fs.promises.writeFile(path.join(directory,'workspaces','legacy.json'),JSON.stringify(legacy));
 const migrated=await getWorkspace('legacy');const reloaded=await getWorkspace('legacy');
 assert.ok(migrated.draftStorageKey);assert.equal(migrated.draftStorageKey,reloaded.draftStorageKey);assert.equal(reloaded.applicant.name,'Legacy student');
}));
test('Blob failures and unexpected responses cannot initialize an empty workspace',async()=>{
 const prior=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN='test-only';
 const originalLoad=Module._load;let mode='error',writes=0;
 Module._load=function(request,...args){if(request==='@vercel/blob')return {get:async()=>{if(mode==='error')throw Error('Blob service unavailable');if(mode==='unexpected')return {statusCode:304,stream:null};return null;},put:async()=>{writes++;}};return originalLoad.call(this,request,...args);};
 try {
   await assert.rejects(getWorkspace('blob'),/Blob service unavailable/);assert.equal(writes,0);
   mode='unexpected';await assert.rejects(getWorkspace('blob'));assert.equal(writes,0);
   mode='missing';assert.ok((await getWorkspace('blob')).draftStorageKey);assert.equal(writes,1);
 }finally{Module._load=originalLoad;if(prior===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=prior;}
});
