import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Run the real orchestration with isolated transport and source adapters.
for(const scenario of ['resume','changed','uncertain','cancelled','network','feed429','aborted','socket','exhausted'])test('runner recovery: '+scenario,async()=>{
 const oldFetch=globalThis.fetch,oldEnv={...process.env},calls=[];let claimed=false,writes=0;
 process.env.BOOKFLIP_SITES_ACCESS='fixture';process.env.ACTIONS_ID_TOKEN_REQUEST_URL='https://fixture.actions.githubusercontent.com/token';
 process.env.BOOKFLIP_RESUME_ONLY='true';
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('.actions.githubusercontent.com'))return Response.json({value:'fixture'});
  const b=JSON.parse(options.body);calls.push(b);
  if(b.action==='claim'){
   if(claimed)return Response.json({task:null});claimed=true;
   return Response.json({task:{id:'t',leaseToken:'l',adapter:'marketplace_html',source:'Vinted',paginationVersion:1,page:1,pageOffset:scenario==='resume'?3:0,pageDigest:scenario==='changed'?'old':'digest',...(scenario==='resume'?{pageCursorVersion:2,pageUrls:Array.from({length:6},(_,i)=>'https://www.vinted.pl/items/'+i),pageCursor:{page:1,digest:'digest',state:'end',nextPage:null}}:{})}});
  }
  if(b.action==='complete'){
   writes++;
   if(scenario==='exhausted'||scenario==='uncertain'&&writes===1)throw Error('connection reset after commit');
   if(scenario==='cancelled')return Response.json({error:'SCAN_LEASE_LOST'},{status:409});
  }
  return Response.json({automatic:true,active:0,processing:6});
 };
 try{
  let code=readFileSync(new URL('./run.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/main\(\)\.catch\([\s\S]*$/,'export {main};').replace('setTimeout(r,2000*(attempt+1))','setTimeout(r,0)');
  const cursor=readFileSync(new URL('./page-cursor.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
  const prefix=cursor+`const createHash=()=>{};const dispatchContinuation=async()=>{throw Error('unexpected continuation')};const scanMarketplace=async()=>{${scenario==='aborted'?"throw new DOMException('The operation was aborted','AbortError');":scenario==='socket'?"throw Object.assign(Error('terminated'),{cause:{code:'UND_ERR_SOCKET'}});":scenario==='network'?"throw TypeError('fetch failed');":scenario==='feed429'?"throw Object.assign(Error('FEED_HTTP_429'),{status:429,retryAfter:180});":''}return ({offers:Array.from({length:6},(_,i)=>({url:'https://www.vinted.pl/items/'+i,title:'Book'})),pagination:{digest:'digest',page:1,total:6,state:'end',nextPage:null},coverage:'fixture'});};\n`;
  const runner=await import('data:text/javascript;base64,'+Buffer.from(prefix+code).toString('base64')+'#'+scenario);await runner.main();
  assert.equal(calls.find(b=>b.action==='ensure').resumeOnly,true);
  const completed=calls.filter(b=>b.action==='complete');
  if(scenario==='resume')assert.deepEqual(completed.map(b=>b.pagination.offset),[3]);
  if(scenario==='changed'){assert.deepEqual(completed.map(b=>b.pagination.offset),[0,3]);}
  if(scenario==='uncertain'){assert.equal(completed[0].requestId,completed[1].requestId);assert.deepEqual(completed[0],completed[1]);}
  if(scenario==='exhausted'){assert.equal(completed.length,3);assert.ok(completed.every(b=>b.requestId===completed[0].requestId));assert.ok(!calls.some(b=>b.action==='fail'));assert.ok(calls.some(b=>b.action==='status'));assert.ok(calls.some(b=>b.action==='report'&&b.outcome==='error'));}
  if(scenario==='cancelled'){assert.equal(completed.length,1);assert.ok(calls.some(b=>b.action==='report'&&b.outcome==='cancelled'));}
  if(['network','feed429','aborted','socket'].includes(scenario)){assert.equal(completed.length,0);assert.ok(calls.some(b=>b.action==='fail'&&b.kind==='temporary'&&b.retryAfterSeconds===(['network','aborted','socket'].includes(scenario)?300:180)));}
  assert.ok(!calls.some(b=>b.action==='fail'&&scenario==='uncertain'));
 }finally{globalThis.fetch=oldFetch;process.env=oldEnv;}
});

