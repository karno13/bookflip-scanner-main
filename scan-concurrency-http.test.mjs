import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAppServer} from './local-app.mjs';
import {createProductionCatalog} from './catalog-production.mjs';

async function fixture(){
 const catalog=createProductionCatalog({databasePath:':memory:',fetcher:async()=>{throw Error('NETWORK_NOT_ALLOWED')}});
 let release,started;
 const startedPromise=new Promise(resolve=>{started=resolve});
 const pending=new Promise(resolve=>{release=resolve});
 let calls=0;
 const search=async()=>{
  calls++;
  started();
  await pending;
  return{results:[{source:'Empik',query:'Warcraft',status:'ok'}],offers:[],searchedAt:'2026-10-31T19:00:00.000Z',summary:{offers:0}};
 };
 const server=createLocalAppServer({catalogProvider:()=>catalog,search});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const base='http://127.0.0.1:'+server.address().port;
 return{
  base,release,started:startedPromise,get calls(){return calls},
  post:(suffix='')=>fetch(base+'/api/search'+suffix,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({queries:['Warcraft'],sources:['Empik']})}),
  async close(){release();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));catalog.close();}
 };
}
test('second concurrent JSON scan returns HTTP 409 without duplicate marketplace requests',async()=>{
 const app=await fixture();
 try{
  const first=app.post();
  await app.started;
  const second=await app.post();
  assert.equal(second.status,409);
  assert.deepEqual(await second.json(),{error:'SCAN_ALREADY_RUNNING'});
  assert.equal(app.calls,1);
  app.release();
  assert.equal((await first).status,200);
  const third=await app.post();
  assert.equal(third.status,200);
  assert.equal(app.calls,2);
 }finally{await app.close();}
});
test('streaming scan blocks concurrent JSON and streaming scans, then releases gate',async()=>{
 const app=await fixture();
 try{
  const first=app.post('?stream=1');
  await app.started;
  const other=await app.post();
  assert.equal(other.status,409);
  const secondStream=await app.post('?stream=1');
  assert.equal(secondStream.status,409);
  assert.equal(app.calls,1);
  app.release();
  const stream=await first;
  assert.equal(stream.status,200);
  const result=await stream.text();
  assert.match(result,/"type":"result"/);
  const after=await app.post();
  assert.equal(after.status,200);
 }finally{await app.close();}
});
