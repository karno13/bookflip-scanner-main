import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocalArgs,runLocalScan} from './local-scan.mjs';

test('local scan defaults to one read-only Empik page and accepts explicit Allegro selection',()=>{
 assert.deepEqual(parseLocalArgs([]).sources,['Empik']);
 const parsed=parseLocalArgs(['--source','allegro','--query','Horus Rising','--page','2','--examples','3']);
 assert.deepEqual(parsed.sources,['Allegro']);assert.equal(parsed.query,'Horus Rising');assert.equal(parsed.page,2);assert.equal(parsed.examples,3);
 assert.throws(()=>parseLocalArgs(['--source','unknown']),/UNKNOWN_SOURCE/);
});

test('local scan uses marketplace scanner without queue credentials and reports safe diagnostics',async()=>{
 const lines=[],tasks=[];
 const success=await runLocalScan(parseLocalArgs(['--query','Warcraft']),{scanner:async task=>{tasks.push(task);return{offers:[{title:'Warcraft książka',price:2990,url:'https://www.empik.com/book,p1,ksiazka-p'}],pagination:{page:1,state:'end'}};},write:line=>lines.push(JSON.parse(line))});
 assert.deepEqual(success,{failed:0,total:1});assert.equal(tasks[0].host,'www.empik.com');assert.equal(lines[0].offers,1);assert.equal(lines[0].examples[0].price,2990);
 const failureLines=[];const failure=await runLocalScan(parseLocalArgs(['--source','Allegro']),{scanner:async()=>{throw Object.assign(Error('SOURCE_CAPTCHA'),{status:403,blocked:true});},write:line=>failureLines.push(JSON.parse(line))});
 assert.deepEqual(failure,{failed:1,total:1});assert.deepEqual(failureLines[0],{source:'Allegro',result:'unavailable',query:'Warcraft',page:1,code:'SOURCE_CAPTCHA',status:403,blocked:true,retryable:false,retryAfter:null});
});
