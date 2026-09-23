const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const Module=require('node:module');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true}}).outputText,file);
function load(file,mocks){const old=Module._load;Module._load=function(name,...args){return Object.hasOwn(mocks,name)?mocks[name]:old.call(this,name,...args);};try{delete require.cache[require.resolve(file)];return require(file);}finally{Module._load=old;}}
function providerFixture(){const calls=[];const state={codex:null,grok:{account:'synthetic'},codexError:null};const result={text:'fixture',model:'fixture',rounds:1,finishReason:'stop',truncated:false};const providers=load('../lib/providers.ts',{
 './codex-session':{getActiveCodexSession:async()=>{if(state.codexError)throw state.codexError;return state.codex;}},
 './grok-session':{getActiveGrokSession:async()=>state.grok},
 './codex-client':{DEFAULT_CODEX_MODEL:'fixture',runCodexChat:async()=>{calls.push('codex');return result;}},
 './grok-client':{DEFAULT_GROK_MODEL:'fixture',runGrokChat:async()=>{calls.push('grok');return result;}},
 './opencode-client':{DEFAULT_OPENCODE_MODEL:'fixture',OPENCODE_MODELS:[],getOpencodeKey:()=>null},
 './ai-models':{providerModels:async()=>[]},
 './web-search-tool':{isWebSearchAvailable:()=>false,isWebFetchAvailable:()=>false,webSearchProviderLabel:()=> 'none'},
});return{...providers,state,calls};}
const request={instructions:'synthetic fixture',turns:[{role:'user',content:'test'}],emit:()=>{}};
test('an explicit unavailable provider never sends the prompt to another account',async()=>{const f=providerFixture();await assert.rejects(f.runChat({...request,preferred:'codex'}),/ChatGPT.*(?:connect|available)/i);assert.deepEqual(f.calls,[]);});
test('Auto can use another available provider and status reports refresh trouble',async()=>{const f=providerFixture();f.state.codexError=Error('Temporary refresh failure');const status=await f.resolveProviderStatus();assert.equal(status.active,'grok');assert.ok(status.connectionErrors.codex);assert.equal((await f.runChat(request)).provider,'grok');});
test('an unrelated broken connection cannot block the explicitly selected provider',async()=>{const f=providerFixture();f.state.codexError=Error('Temporary refresh failure');assert.equal((await f.runChat({...request,preferred:'grok'})).provider,'grok');});
for(const provider of ['codex','grok'])test(`${provider} refresh network failures preserve the saved session for retry`,async()=>{
 const deleted=[];const tokens={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:0};
 const jar={get:name=>name===`${provider}_session_0`?{value:JSON.stringify(tokens)}:undefined,set:()=>{},delete:name=>deleted.push(name)};
 const session=load(`../lib/${provider}-session.ts`,{'next/headers':{cookies:()=>jar},[`./${provider}-oauth`]:provider==='codex'?{refreshTokens:async()=>{throw Error('Synthetic network failure');}}:{refreshGrokTokens:async()=>{throw Error('Synthetic network failure');}}});
 await assert.rejects(provider==='codex'?session.getActiveCodexSession():session.getActiveGrokSession(),/refresh|retry|connection/i);assert.deepEqual(deleted,[]);
});
