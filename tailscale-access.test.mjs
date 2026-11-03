import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createLocalAppServer} from './local-app.mjs';
import {tailscaleAccessFromEnv,validateBookflipRequest} from './tailscale-access.mjs';

const host = 'bookflip-pc.example-tailnet.ts.net';
const user = 'bookflip@example.com';
const access = {host,user};

test('Tailscale access is opt-in and requires a valid host and account',()=>{
  assert.equal(tailscaleAccessFromEnv({}),null);
  assert.deepEqual(tailscaleAccessFromEnv({
    BOOKFLIP_TAILSCALE_HOST:host.toUpperCase(),
    BOOKFLIP_TAILSCALE_USER:user.toUpperCase(),
  }),access);
  for(const value of ['evil.example','https://'+host,host+':443',
    'bookflip-pc.example-tailnet.ts.net.evil.com']){
    assert.throws(()=>tailscaleAccessFromEnv({
      BOOKFLIP_TAILSCALE_HOST:value,BOOKFLIP_TAILSCALE_USER:user,
    }),/INVALID_TAILSCALE_CONFIGURATION/);
  }
  assert.throws(()=>tailscaleAccessFromEnv({BOOKFLIP_TAILSCALE_HOST:host}),/INVALID_TAILSCALE_CONFIGURATION/);
});

function getOrPost(port,{method='GET',hostHeader=host,origin,identity=user,contentType='application/json'}={}){
  return new Promise((resolve,reject)=>{
    const headers={Host:hostHeader};
    if(origin!==undefined) headers.Origin=origin;
    if(identity!==undefined) headers['Tailscale-User-Login']=identity;
    if(method==='POST') headers['Content-Type']=contentType;
    const req=httpRequest({
      hostname:'127.0.0.1',port,path:method==='POST'?'/api/search/cancel':'/api/sources',
      method,headers,
    },res=>{
      let body='';res.setEncoding('utf8');
      res.on('data',chunk=>body+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    });
    req.on('error',reject);
    if(method==='POST')req.write('{}');
    req.end();
  });
}

test('only exact Serve hostname, injected user identity and HTTPS origin are accepted',async()=>{
  const server=createLocalAppServer({tailscaleAccess:access});
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const port=server.address().port;
  try{
    assert.equal((await getOrPost(port)).status,200);
    assert.equal((await getOrPost(port,{identity:undefined})).status,403);
    assert.equal((await getOrPost(port,{identity:'other@example.com'})).status,403);
    assert.equal((await getOrPost(port,{hostHeader:'evil.example'})).status,403);
    assert.equal((await getOrPost(port,{hostHeader:host+'.evil.com'})).status,403);
    assert.equal((await getOrPost(port,{method:'POST',origin:'https://'+host})).status,409);
    assert.equal((await getOrPost(port,{method:'POST',origin:'http://'+host})).status,403);
    assert.equal((await getOrPost(port,{method:'POST',origin:'https://attacker.example'})).status,403);
    assert.equal((await getOrPost(port,{method:'POST',origin:undefined})).status,403);
    assert.equal((await getOrPost(port,{method:'POST',origin:'https://'+host,contentType:'text/plain'})).status,415);
    assert.equal((await getOrPost(port,{hostHeader:'127.0.0.1:'+port,identity:undefined})).status,200);
  }finally{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});

test('Tailscale hostname alone cannot bypass loopback peer or injected identity',()=>{
  const req={method:'GET',socket:{localPort:4317,remoteAddress:'100.101.102.103'},
    headers:{host,'tailscale-user-login':user}};
  assert.deepEqual(validateBookflipRequest(req,access),{status:403,error:'INVALID_HOST'});
  req.socket.remoteAddress='127.0.0.1';
  assert.equal(validateBookflipRequest(req,access),null);
});
