import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SqliteCatalogRepository} from './sqlite-catalog-repository.mjs';
import {importJsonV2Data,importJsonV2File} from './import-json-v2-to-sqlite.mjs';

const at='2026-10-30T10:00:00.000Z',isbn='9780306406157';
const fixture={version:2,updatedAt:at,books:{
 'isbn:9780306406157':{id:'isbn:9780306406157',title:'Wydanie historyczne',isbn,origin:'detected',firstSeenAt:at,lastSeenAt:at},
 'book:manual':{id:'book:manual',title:'Ręczny katalog',isbn:null,origin:'manual',firstSeenAt:at,lastSeenAt:at}
},offers:{
 'Vinted:1':{id:'Vinted:1',bookId:'isbn:9780306406157',linkMode:'detected',originalTitle:'Historyczna oferta',currentPrice:1000,source:'Vinted',url:'https://www.vinted.pl/items/1-book',firstSeenAt:at,lastSeenAt:at,availability:'unconfirmed',matchedQueries:['book'],isbn,language:'Polski',seenCount:2},
 'Example:https://example.test/manual':{id:'Example:https://example.test/manual',bookId:'book:manual',linkMode:'manual',originalTitle:'Ręczna oferta',currentPrice:2000,source:'Example',url:'https://example.test/manual',firstSeenAt:at,lastSeenAt:at,availability:'unconfirmed',matchedQueries:[],isbn:null,language:null,seenCount:1},
 'Example:https://example.test/unlinked':{id:'Example:https://example.test/unlinked',bookId:null,linkMode:null,originalTitle:'Bez przypisania',currentPrice:3000,source:'Example',url:'https://example.test/unlinked',firstSeenAt:at,lastSeenAt:at,availability:'unconfirmed',matchedQueries:[],isbn:null,language:null,seenCount:1}
},priceHistory:[
 {offerId:'Vinted:1',price:1100,observedAt:'2026-10-29T10:00:00.000Z'},
 {offerId:'Vinted:1',price:1000,observedAt:at},
 {offerId:'Example:https://example.test/manual',price:2000,observedAt:at},
 {offerId:'Example:https://example.test/unlinked',price:3000,observedAt:at}
],details:{},lastScan:null};

function workspace(){const directory=mkdtempSync(join(tmpdir(),'bookflip-sqlite-test-'));return{directory,database:join(directory,'catalog.sqlite')};}
function repository(t,options={}){const {directory,database}=workspace(),repo=new SqliteCatalogRepository(database,{now:()=>new Date(at),...options});t.after(()=>{try{repo.close();}catch{}rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:25});});return repo;}
function runWorker(database,workId){return new Promise((resolve,reject)=>{const worker=fileURLToPath(new URL('./sqlite-concurrency-worker.mjs',import.meta.url)),child=spawn(process.execPath,['--no-warnings',worker,database,workId,isbn,'Wydanie równoległe'],{stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.on('exit',code=>code===0?resolve(output):reject(Error(error||`WORKER_EXIT_${code}`)));});}

test('schema enables foreign keys, WAL, migrations and required indexes',t=>{
 const repo=repository(t),foreign=repo.database.prepare('PRAGMA foreign_keys').get(),journal=repo.database.prepare('PRAGMA journal_mode').get(),timeout=repo.database.prepare('PRAGMA busy_timeout').get(),migration=repo.database.prepare('SELECT * FROM schema_migrations').get();
 assert.equal(Number(foreign.foreign_keys),1);assert.equal(String(journal.journal_mode).toLowerCase(),'wal');assert.equal(Number(timeout.timeout),5000);assert.equal(Number(migration.version),1);
 const indexes=new Set(repo.database.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all().map(row=>row.name));
 for(const name of ['uq_offers_source_external','uq_offers_source_url','uq_offer_matches_active','idx_identification_jobs_claim'])assert.ok(indexes.has(name));
});

test('foreign keys and unique ISBN constraints reject invalid relations',t=>{
 const repo=repository(t),one=repo.createWork({title:'Pierwsze'}),two=repo.createWork({title:'Drugie'}),editionOne=repo.createEdition({workId:one.id,title:'Pierwsze'}),editionTwo=repo.createEdition({workId:two.id,title:'Drugie'});
 repo.attachIdentifier(editionOne.id,'isbn13',isbn);
 assert.throws(()=>repo.attachIdentifier(editionTwo.id,'isbn13',isbn),/EDITION_IDENTIFIER_CONFLICT/);
 assert.throws(()=>repo.database.prepare(`INSERT INTO editions(id,work_id,title,created_at,updated_at) VALUES('bad','missing','Bad',?,?)`).run(at,at),/FOREIGN KEY/);
});

test('external work lookup and metadata evidence use durable provenance records',t=>{
 const repo=repository(t),work=repo.createWork({title:'Zewnętrzne dzieło'}),edition=repo.createEdition({workId:work.id,title:'Zewnętrzne wydanie'}),record=repo.putExternalRecord({provider:'open_library',externalId:'OL1W',recordType:'work',workId:work.id,payload:{title:'Zewnętrzne dzieło'},payloadHash:'hash-1',fetchedAt:at});
 assert.equal(repo.findWorkByExternalId('open_library','OL1W').id,work.id);
 const evidence=repo.putMetadataEvidence({editionId:edition.id,externalRecordId:record.id,fieldName:'title',value:'Zewnętrzne wydanie',classification:'structured',sourceType:'open_library',verificationStatus:'verified',observedAt:at});
 assert.throws(()=>repo.database.prepare('UPDATE metadata_evidence SET value_json=? WHERE id=?').run(JSON.stringify('zmiana'),evidence.id),/METADATA_EVIDENCE_IMMUTABLE/);
});

test('repository transaction rolls back every related write on error',t=>{
 const repo=repository(t);assert.throws(()=>repo.transaction(()=>{repo.createWork({id:'rolled-back',title:'Rollback'});throw Error('EXPECTED_FAILURE');}),/EXPECTED_FAILURE/);
 assert.equal(repo.database.prepare(`SELECT count(*) AS count FROM works WHERE id='rolled-back'`).get().count,0);
});

test('data remains readable after closing and reopening the database',t=>{
 const {directory,database}=workspace();t.after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:25}));let repo=new SqliteCatalogRepository(database,{now:()=>new Date(at)}),work=repo.createWork({id:'restart-work',title:'Restart'});repo.createEditionForISBN({workId:work.id,isbn,title:'Restart'});repo.close();
 repo=new SqliteCatalogRepository(database,{now:()=>new Date(at)});assert.equal(repo.findEditionByISBN(isbn).work_id,'restart-work');repo.close();
});

test('two parallel processes converge on one edition for an ISBN',async t=>{
 const {directory,database}=workspace();t.after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:25}));const repo=new SqliteCatalogRepository(database,{busyTimeout:10000,now:()=>new Date(at)}),work=repo.createWork({id:'parallel-work',title:'Równoległe'});repo.close();
 const ids=await Promise.all([runWorker(database,work.id),runWorker(database,work.id)]);assert.equal(ids[0],ids[1]);
 const check=new SqliteCatalogRepository(database);assert.equal(check.counts().editions,1);assert.equal(check.counts().edition_identifiers,1);check.close();
});

test('JSON v2 import preserves offers, prices, manual links and uncertain historical matches',t=>{
 const repo=repository(t),report=importJsonV2Data(fixture,repo,{now:()=>new Date(at)}),counts=repo.counts();
 assert.deepEqual(report.source,{books:2,offers:3,priceHistory:4});
 assert.equal(counts.works,2);assert.equal(counts.editions,2);assert.equal(counts.edition_identifiers,1);assert.equal(counts.offers,3);assert.equal(counts.offer_price_history,4);assert.equal(counts.offer_matches,2);
 const manual=repo.getOfferMatchHistory('Example:https://example.test/manual')[0],historical=repo.getOfferMatchHistory('Vinted:1')[0];
 assert.equal(manual.method,'legacy_manual');assert.equal(manual.status,'active');assert.equal(historical.method,'legacy_isbn');assert.equal(historical.status,'review_required');
 assert.equal(repo.getIdentificationStatus('Vinted:1').job.status,'review_required');assert.equal(repo.getIdentificationStatus('Example:https://example.test/manual').job.status,'completed');assert.equal(report.conflicts.count,0);
});

test('JSON v2 import is idempotent and does not create duplicate records',t=>{
 const repo=repository(t);importJsonV2Data(fixture,repo,{now:()=>new Date(at)});const before=repo.counts(),second=importJsonV2Data(fixture,repo,{now:()=>new Date(at)});
 assert.deepEqual(repo.counts(),before);assert.equal(Object.values(second.inserted).reduce((sum,value)=>sum+value,0),0);assert.equal(second.duplicates.offers,3);assert.equal(second.duplicates.offer_price_history,4);
});

test('file importer reads a snapshot, writes a report and never changes the source JSON',t=>{
 const {directory,database}=workspace();t.after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:25}));const source=join(directory,'history.json'),snapshot=join(directory,'snapshot.json'),reportPath=join(directory,'report.json');writeFileSync(source,JSON.stringify(fixture,null,2));
 const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash(),report=importJsonV2File({sourcePath:source,databasePath:database,snapshotPath:snapshot,reportPath});
 assert.equal(hash(),before);assert.ok(existsSync(snapshot));assert.ok(existsSync(reportPath));assert.equal(report.after.offers,3);assert.equal(JSON.parse(readFileSync(reportPath,'utf8')).after.offer_price_history,4);
});
