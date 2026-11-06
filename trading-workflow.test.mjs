import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProductionCatalog} from './catalog-production.mjs';
import {createLocalAppServer,searchOffers} from './local-app.mjs';
import {persistSqliteScan} from './sqlite-single-store.mjs';
import {listCatalogOffers,listCatalogWorks,getCatalogWork,matchIdentificationJobByIsbn,decideIdentificationJob} from './catalog-api.mjs';
import {setOfferWorkspace} from './offer-workspace-api.mjs';
import {markOfferAsSet,updateSetEdition,listOfferSets} from './offer-sets.mjs';
import {getOfferScenario,saveOfferScenario,getTradingDefaults,saveTradingDefaults,mergeCatalogWorks,reopenReviewDecision,tradingRoute} from './trading-api.mjs';
import {verifyCatalogBackup} from './scripts/restore-catalog.mjs';

function catalog(){return createProductionCatalog({databasePath:':memory:',fetcher:async()=>{throw Error('NETWORK_NOT_ALLOWED');}});}
function offer(repo,index,price=2500){return repo.upsertOffer({source:'Empik',normalizedUrl:`https://www.empik.com/test-${index},p${index},ksiazka-p`,originalTitle:'Solaris '+index,currentPrice:price,at:'2026-11-01T12:00:00.000Z'});}
test('purchase and target filters query the entire database before pagination',()=>{
  const c=catalog();try{
    let watched;
    c.repository.transaction(repo=>{for(let i=0;i<300;i++){const row=offer(repo,i);if(i===299)watched=row;}});
    setOfferWorkspace(c.repository,watched.id,{watched:true,status:'negotiating',targetPrice:30,note:'check'});
    assert.equal(listCatalogOffers(c.repository,{watched:'1',limit:25}).items[0].id,watched.id);
    assert.equal(listCatalogOffers(c.repository,{target:'1'}).total,1);
    assert.equal(listCatalogOffers(c.repository,{purchaseStatus:'negotiating'}).total,1);
    assert.equal(listCatalogOffers(c.repository,{purchaseStatus:'bought'}).total,0);
    assert.equal(listCatalogOffers(c.repository,{minPrice:26}).total,0);
    assert.equal(listCatalogOffers(c.repository,{limit:25,offset:275}).items.length,25);
  }finally{c.close();}
});
test('scan membership and new/changed classifications remain tied to their original scan',()=>{
  const c=catalog();try{
    const item={source:'Empik',url:'https://www.empik.com/solaris,p1,ksiazka-p',title:'Solaris',price:2500};
    persistSqliteScan(c,{offers:[item],searchedAt:'2026-11-01T00:00:00Z'});
    persistSqliteScan(c,{offers:[{...item,price:2000}],searchedAt:'2026-11-02T00:00:00Z',scanContext:{queries:['Solaris'],sources:['Empik'],results:[{source:'Empik',status:'ok'}]}});
    assert.equal(listCatalogOffers(c.repository,{scan:'2026-11-01T00:00:00Z',scanChange:'new'}).total,1);
    assert.equal(listCatalogOffers(c.repository,{scan:'2026-11-02T00:00:00Z',scanChange:'new'}).total,0);
    assert.equal(listCatalogOffers(c.repository,{scan:'2026-11-02T00:00:00Z',scanChange:'price'}).total,1);
    assert.equal(c.repository.database.prepare('SELECT status FROM source_health').get().status,'ok');
  }finally{c.close();}
});
test('retry executes only failed source/query pairs, without adding cross combinations',async()=>{
  const calls=[];
  const result=await searchOffers({queries:['Solaris','Diuna'],sources:['Empik','OLX'],tasks:[{source:'Empik',query:'Solaris'},{source:'OLX',query:'Diuna'}]},
    {scanner:async task=>{calls.push([task.source,task.searchQuery]);return {offers:[],pagination:{state:'end'}};}});
  assert.deepEqual(calls.sort(),[['Empik','Solaris'],['OLX','Diuna']]);assert.equal(result.results.length,2);
  await assert.rejects(searchOffers({queries:['Solaris'],sources:['Empik'],tasks:[{source:'OLX',query:'Solaris'}]}),/INVALID_SCAN_TASKS/);
});
test('scenario and defaults survive reopen and reject fractional cents and negative values',()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookflip-trading-'));let c=createProductionCatalog({databasePath:join(directory,'db.sqlite')});
  try{
    const item=offer(c.repository,1);saveTradingDefaults(c.repository,{shipping:8.99,other:2});
    saveOfferScenario(c.repository,item.id,{purchase:25,shipping:8.99,other:2,resale:50,actualPurchase:23});
    assert.throws(()=>saveOfferScenario(c.repository,item.id,{purchase:-1}),/INVALID_AMOUNT/);
    assert.throws(()=>saveTradingDefaults(c.repository,{shipping:0.001,other:0}),/INVALID_AMOUNT/);
    c.close();c=createProductionCatalog({databasePath:join(directory,'db.sqlite')});
    assert.equal(getOfferScenario(c.repository,item.id).actualPurchase,23);assert.deepEqual(getTradingDefaults(c.repository),{shipping:8.99,other:2});
  }finally{c.close();rmSync(directory,{recursive:true,force:true});}
});
test('ISBN preview never assigns or completes; confirmation records an auditable manual decision',async()=>{
  const c=catalog();try{
    const work=c.repository.createWork({title:'Solaris'}),edition=c.repository.createEdition({workId:work.id,title:'Solaris'});
    c.repository.attachIdentifier(edition.id,'isbn13','9780306406157',{source:'test'});
    const item=c.repository.upsertOffer({source:'Empik',normalizedUrl:'https://www.empik.com/solaris,p123,ksiazka-p',originalTitle:'Solaris',currentPrice:2500});
    const job=c.repository.putIdentificationJob({offerId:item.id,status:'review_required'});
    const preview=await matchIdentificationJobByIsbn(c,job.id,{isbn:'9780306406157',preview:true});
    assert.equal(preview.canConfirm,true);assert.equal(c.repository.database.prepare("SELECT count(*) AS n FROM offer_matches WHERE status='active'").get().n,0);
    assert.equal(c.repository.database.prepare('SELECT status FROM identification_jobs WHERE id=?').get(job.id).status,'review_required');
    const confirmed=await matchIdentificationJobByIsbn(c,job.id,{isbn:'9780306406157',confirm:true});assert.equal(confirmed.matched,true);
    assert.equal(c.repository.database.prepare('SELECT action FROM review_decisions').get().action,'approved');
    const decision=c.repository.database.prepare('SELECT id FROM review_decisions').get();reopenReviewDecision(c.repository,decision.id);
    assert.equal(c.repository.database.prepare('SELECT status FROM identification_jobs WHERE id=?').get(job.id).status,'review_required');
    assert.equal(c.repository.database.prepare('SELECT count(*) AS n FROM review_decisions').get().n,1);
    assert.throws(()=>reopenReviewDecision(c.repository,decision.id),/ALREADY_REOPENED/);
  }finally{c.close();}
});
test('work edits and confirmed merges retain editions, offers and old work links',async()=>{
  const c=catalog();try{
    const source=c.repository.createWork({title:'Duplicate'}),target=c.repository.createWork({title:'Canonical'});
    const edition=c.repository.createEdition({workId:source.id,title:'Edition',language:'pl',publisher:'Publisher',publicationYear:2024});
    const before=c.repository.counts();assert.equal(mergeCatalogWorks(c.repository,source.id,target.id).merged,undefined);
    assert.equal(c.repository.counts().works,before.works);
    mergeCatalogWorks(c.repository,source.id,target.id,true);
    assert.equal(listCatalogWorks(c.repository).total,1);assert.equal(getCatalogWork(c.repository,source.id).id,target.id);
    assert.equal(getCatalogWork(c.repository,target.id).editions[0].id,edition.id);
    assert.equal(c.repository.createEdition({workId:source.id,title:'Later'}).work_id,target.id);
    const updated=await tradingRoute({repo:c.repository,method:'PUT',path:'/api/catalog/works/'+target.id,input:{title:'ŻABA',authors:['Łucja']}});
    assert.equal(updated.title,'ŻABA');assert.equal(listCatalogWorks(c.repository,{query:'żaba',language:'pl',publisher:'publisher',year:2024}).total,1);
  }finally{c.close();}
});
test('bundle quantities, unknown items and composition confirmation have persistent validation',async()=>{
  const c=catalog();try{
    const item=offer(c.repository,1),work=c.repository.createWork({title:'Set'}),edition=c.repository.createEdition({workId:work.id,title:'Book'});
    markOfferAsSet(c.repository,item.id);updateSetEdition(c.repository,item.id,edition.id,true);
    const route=(method,path,input)=>tradingRoute({repo:c.repository,method,path,input});
    await route('PUT','/api/set-items/'+item.id+'/'+edition.id,{quantity:3,resalePrice:15});
    await route('POST','/api/set-unknown/'+item.id,{title:'Nieczytelny grzbiet',quantity:2});
    await assert.rejects(route('PUT','/api/set-details/'+item.id,{confirmed:true}),/UNKNOWN_ITEMS/);
    const set=listOfferSets(c.repository)[0];assert.equal(set.editions[0].quantity,3);assert.equal(set.unknownItems[0].quantity,2);
    await route('DELETE','/api/set-unknown/'+item.id+'/'+set.unknownItems[0].id);
    await route('PUT','/api/set-details/'+item.id,{confirmed:true});assert.equal(listOfferSets(c.repository)[0].compositionConfirmed,true);
    await assert.rejects(route('PUT','/api/set-items/'+item.id+'/'+edition.id,{quantity:1.5,resalePrice:0}),/INVALID_QUANTITY/);
  }finally{c.close();}
});
test('new HTTP routes require the same origin protections and persist a scenario',async()=>{
  const c=catalog();const item=offer(c.repository,1);const server=createLocalAppServer({catalogProvider:()=>c});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    const path='/api/offer-scenarios/'+encodeURIComponent(item.id);
    const forbidden=await fetch(base+path,{method:'PUT',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(forbidden.status,403);
    const saved=await fetch(base+path,{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({purchase:25,resale:40,shipping:5,other:0,actualPurchase:null})});assert.equal(saved.status,200);
    assert.equal((await (await fetch(base+path)).json()).resale,40);
    assert.equal((await (await fetch(base+'/api/data/overview')).json()).databasePath,':memory:');
    const profile={name:'Unique',queries:['Solaris'],sources:['Empik']};
    const create=()=>fetch(base+'/api/scan-profiles',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(profile)});
    assert.equal((await create()).status,201);assert.equal((await create()).status,409);
  }finally{await new Promise(resolve=>server.close(resolve));c.close();}
});

test('backup action creates a verified new catalog and reports its date',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'bookflip-ui-backup-'));const c=createProductionCatalog({databasePath:join(directory,'catalog.sqlite')});
  try{
    offer(c.repository,1);
    const result=await tradingRoute({repo:c.repository,method:'POST',path:'/api/data/backup',input:{}});
    assert.equal(existsSync(result.path),true);assert.equal(verifyCatalogBackup(result.path).valid,true);assert.ok(result.lastBackupAt);
    const second=await tradingRoute({repo:c.repository,method:'POST',path:'/api/data/backup',input:{}});assert.notEqual(second.path,result.path);
  }finally{c.close();rmSync(directory,{recursive:true,force:true});}
});

test('merge conflicts roll back without moving any editions',()=>{
  const c=catalog();try{
    const source=c.repository.createWork({title:'Source'}),target=c.repository.createWork({title:'Target'});
    const edition=c.repository.createEdition({workId:source.id,title:'Keep here'});
    for(const [id,volume]of [[source.id,1],[target.id,2]])c.repository.database.prepare('INSERT INTO work_series_annotations VALUES(?,?,?,?)').run(id,'Series',volume,'now');
    assert.throws(()=>mergeCatalogWorks(c.repository,source.id,target.id,true),/SERIES_CONFLICT/);
    assert.equal(getCatalogWork(c.repository,source.id).editions[0].id,edition.id);assert.equal(listCatalogWorks(c.repository).total,2);
  }finally{c.close();}
});
