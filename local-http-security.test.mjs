import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAppServer} from './local-app.mjs';

test('local server rejects foreign Host, cross-origin and non-JSON writes', async () => {
  const server=createLocalAppServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const port=server.address().port;
  const base='http://127.0.0.1:'+port;
  try {
    let response=await fetch(base+'/api/sources',{headers:{Host:'evil.example:'+port}});
    assert.equal(response.status,403);assert.equal((await response.json()).error,'INVALID_HOST');
    response=await fetch(base+'/api/sources',{headers:{Host:'127.0.0.1:'+port}});
    assert.equal(response.status,200);
    response=await fetch(base+'/api/catalog',{method:'POST',headers:{'Content-Type':'text/plain','Origin':'https://attacker.example'},body:'{}'});
    assert.equal(response.status,403);assert.equal((await response.json()).error,'INVALID_ORIGIN');
    response=await fetch(base+'/api/catalog',{method:'POST',headers:{'Content-Type':'text/plain','Origin':base},body:'{}'});
    assert.equal(response.status,415);assert.equal((await response.json()).error,'JSON_REQUIRED');
    response=await fetch(base+'/api/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,403);assert.equal((await response.json()).error,'ORIGIN_REQUIRED');
    response=await fetch(base+'/api/sources');
    assert.match(response.headers.get('content-security-policy'),/covers\.openlibrary\.org/);
  } finally {
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
