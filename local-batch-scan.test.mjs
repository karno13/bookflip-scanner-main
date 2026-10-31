import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLocalBatch} from './local-batch-scan.mjs';

test('local batch scans every source-query pair and preserves partial results',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bookflip-local-scan-')),logs=[];
 const {report,outputPath}=await runLocalBatch({queries:['Warcraft','Warhammer'],sources:['Empik','Allegro'],outputDirectory:directory,now:()=>new Date('2026-10-29T12:00:00Z'),log:line=>logs.push(JSON.parse(line)),scanner:async task=>{if(task.source==='Allegro')throw Object.assign(Error('SOURCE_CAPTCHA'),{status:403,blocked:true});return{offers:[{title:task.searchQuery+' książka',url:'https://www.empik.com/book,p1,ksiazka-p',price:2990}],pagination:{page:1,state:'end'},coverage:'fixture'};}});
 assert.deepEqual(report.summary,{attempted:4,read:2,unavailable:2,offers:2,uniqueOffers:1});assert.equal(report.results.length,4);assert.equal(report.results[1].diagnostic.code,'SOURCE_CAPTCHA');assert.equal(logs.at(-1).result,'saved');
 const saved=JSON.parse(await readFile(outputPath,'utf8'));assert.equal(saved.finishedAt,'2026-10-29T12:00:00.000Z');assert.equal(saved.results[0].offers[0].price,2990);assert.deepEqual(saved.offers[0].matchedQueries,['Warcraft','Warhammer']);
});
