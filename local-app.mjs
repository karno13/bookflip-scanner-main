import {createServer} from 'node:http';
import {readFile,appendFile} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {scanMarketplace} from './marketplaces.mjs';
import {localSourceHosts} from './local-scan.mjs';
import {readVintedLanguage} from './vinted-detail.mjs';
import {loadOfferHistory,saveOfferHistory,applyScanToHistory,sourceOfferId,createCatalogBook,linkOfferToBook} from './offer-history.mjs';
import {createProductionCatalog,productionCatalogEnabled} from './catalog-production.mjs';
import {decideIdentificationJob,getCatalogEdition,getCatalogOffer,getCatalogWork,listCatalogOffers,listCatalogWorks,listIdentificationJobs} from './catalog-api.mjs';
import {offerExternalId} from './offer-identity.mjs';
import {importJsonV2Data} from './import-json-v2-to-sqlite.mjs';
import {analyzedOffers,bookHistory,bookStatistics} from './price-analysis.mjs';
import {persistScannedOffers} from './scan-persistence.mjs';

const appDirectory=fileURLToPath(new URL('./app/',import.meta.url));
const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};

export function validateSearchInput(input){
 const queries=[...new Set((Array.isArray(input?.queries)?input.queries:[]).map(value=>String(value).trim()).filter(Boolean))];
 const sources=[...new Set((Array.isArray(input?.sources)?input.sources:[]).map(String))];
 if(!queries.length||queries.length>10||queries.some(query=>query.length>120))throw Object.assign(Error('INVALID_QUERIES'),{statusCode:400});
 if(!sources.length||sources.length>Object.keys(localSourceHosts).length||sources.some(source=>!localSourceHosts[source]))throw Object.assign(Error('INVALID_SOURCES'),{statusCode:400});
 return{queries,sources};
}

const retryLimit=3;
function safeCode(error){return /^[A-Z0-9_]+$/.test(error?.message)?error.message:'SOURCE_REQUEST_FAILED';}
function errorDiagnostic(error){return{code:safeCode(error),httpStatus:Number.isInteger(error?.status)?error.status:null,blocked:error?.blocked===true,retryable:isRetryable(error)};}
function isRetryable(error){if(error?.blocked===true)return false;if(error?.retryable===true)return true;if([408,425,429].includes(error?.status)||error?.status>=500)return true;if(['AbortError','TimeoutError'].includes(error?.name))return true;return /(?:SOURCE_REQUEST_FAILED|fetch failed|socket|timeout|timed out|ECONNRESET|ETIMEDOUT)/i.test(String(error?.message||''));}
function retryDelay(error,attempt){const suggested=Number(error?.retryAfter)*1000,fallback=1000*2**(attempt-1);return Math.min(30000,Math.max(1000,Number.isFinite(suggested)?suggested:fallback));}
async function retryRead(read,{onProgress=()=>{},waiter=wait,context={}}={}){for(let attempt=1;attempt<=retryLimit;attempt++)try{return{value:await read(),error:null};}catch(error){if(attempt===retryLimit||!isRetryable(error))return{value:null,error};const delayMs=retryDelay(error,attempt);onProgress({type:'retry',...context,attempt:attempt+1,maxAttempts:retryLimit,delayMs,code:safeCode(error)});await waiter(delayMs);}return{value:null,error:Error('SOURCE_REQUEST_FAILED')};}

export async function searchOffers(input,{scanner=scanMarketplace,languageReader=readVintedLanguage,now=()=>new Date(),onProgress=()=>{},detailCache=new Map(),retryWait=wait}={}){
 const {queries,sources}=validateSearchInput(input),results=[],languageCache=detailCache;
 await Promise.all(sources.map(async source=>{
  for(const query of queries){const task={source,host:localSourceHosts[source],mode:'discovery',title:query,category:query,language:'pl',searchQuery:query,page:1,paginationVersion:1};
   onProgress({type:'source-start',source,query});
   try{const scan=await scanAllPages(task,scanner,event=>onProgress({...event,source,query}),retryWait);let offers=scan.offers,diagnostic=scan.diagnostic;if(source==='Vinted'&&task.language==='pl'&&offers.length){onProgress({type:'language-start',source,query,count:offers.length});const filtered=await filterVintedPolishOffers(offers,languageReader,event=>onProgress({...event,source,query}),languageCache,retryWait);offers=filtered.offers;diagnostic=diagnostic||filtered.diagnostic;}const status=diagnostic?(offers.length?'partial':'unavailable'):'ok';if(diagnostic)onProgress({type:'source-error',source,query,code:diagnostic.code,partial:offers.length});results.push({source,query,status,offers,pagination:scan.pagination,pages:scan.pages,...(diagnostic?{diagnostic}:{})});onProgress({type:'source-done',source,query,offers:offers.length,pages:scan.pages.length,status});}
   catch(error){const diagnostic=errorDiagnostic(error);onProgress({type:'source-error',source,query,code:diagnostic.code,partial:0});results.push({source,query,status:'unavailable',offers:[],diagnostic});}
  }
 }));
 const offersByUrl=new Map();
 for(const row of results){for(const offer of row.offers){const existing=offersByUrl.get(offer.url);if(existing){if(!existing.matchedQueries.includes(row.query))existing.matchedQueries.push(row.query);continue;}offersByUrl.set(offer.url,{...offer,source:row.source,matchedQueries:[row.query]});}}
 const offers=[...offersByUrl.values()].sort((a,b)=>a.price-b.price||a.title.localeCompare(b.title,'pl'));
 return{searchedAt:now().toISOString(),category:'books',language:'pl',queries,sources,summary:{offers:offers.length,successful:results.filter(row=>row.status==='ok').length,partial:results.filter(row=>row.status==='partial').length,unavailable:results.filter(row=>row.status==='unavailable').length},offers,results:results.map(({offers,...row})=>({...row,count:offers.length}))};
}
async function scanAllPages(task,scanner,onProgress=()=>{},waiter=wait){const offers=[],seenPages=new Set(),pages=[];let current={...task},diagnostic=null;for(let pageIndex=0;pageIndex<50;pageIndex++){if(seenPages.has(current.page)){diagnostic=errorDiagnostic(Error('PAGINATION_LOOP'));break;}seenPages.add(current.page);onProgress({type:'page-start',page:current.page});const read=await retryRead(()=>scanner(current),{onProgress,waiter,context:{scope:'page',page:current.page}});if(read.error){diagnostic=errorDiagnostic(read.error);break;}const scan=read.value;offers.push(...scan.offers);pages.push({page:current.page,count:scan.offers.length,state:scan.pagination?.state||'unknown'});onProgress({type:'page-done',page:current.page,count:scan.offers.length,state:scan.pagination?.state||'unknown',total:offers.length});const next=scan.pagination?.nextPage;if(scan.pagination?.state!=='more'||!Number.isInteger(next)||next<=current.page)break;current={...current,page:next};}return{offers,pagination:diagnostic?{state:'partial',nextPage:current.page}:pages.at(-1)?.state==='more'?{state:'limit',nextPage:current.page}:pages.at(-1),pages,diagnostic};}
async function filterVintedPolishOffers(offers,languageReader,onProgress=()=>{},cache=new Map(),waiter=wait){offers=[...new Map(offers.map(offer=>[offer.url,offer])).values()];const accepted=[];let checked=0,unknown=0,cached=0,diagnostic=null;for(const offer of offers){let detail=cache.get(offer.url);if(detail)cached++;else{const read=await retryRead(()=>languageReader(offer.url),{onProgress,waiter,context:{scope:'vinted-language',item:checked+1,total:offers.length}});if(read.error){diagnostic=errorDiagnostic(read.error);break;}detail=read.value;cache.set(offer.url,detail);}checked++;if(/^(?:pl|pol|polish|polski|język polski)$/i.test(String(detail.language||'')))accepted.push({...offer,language:'Polski',...(detail.isbn?{isbn:detail.isbn,isbnEvidence:'Vinted — szczegóły oferty'}:{})});else if(!detail.language)unknown++;onProgress({type:'language-progress',checked,total:offers.length,accepted:accepted.length,unknown,cached});}return{offers:accepted,diagnostic};}

async function readJson(request){let size=0,text='';for await(const chunk of request){size+=chunk.length;if(size>32768)throw Object.assign(Error('REQUEST_TOO_LARGE'),{statusCode:413});text+=chunk;}try{return JSON.parse(text||'{}');}catch{throw Object.assign(Error('INVALID_JSON'),{statusCode:400});}}
function send(response,status,body,type='application/json; charset=utf-8'){response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://covers.openlibrary.org; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});response.end(body);}
const logPath=fileURLToPath(new URL('./scan-results/local-app.log',import.meta.url));
let productionCatalog=null;
function getProductionCatalog(){if(!productionCatalogEnabled())return null;if(!productionCatalog)productionCatalog=createProductionCatalog();return productionCatalog;}
// Incremental compatibility bridge: manual JSON operations must not replay the
// entire historical snapshot into a live SQLite catalog.
export function legacySyncSlice(history,{bookId,offerId}={}){
 const books=Object.create(null),offers=Object.create(null);
 if(bookId&&history.books?.[bookId])books[bookId]=history.books[bookId];
 if(offerId&&history.offers?.[offerId]){
  offers[offerId]=history.offers[offerId];
  const linkedBookId=offers[offerId].bookId;
  if(linkedBookId&&history.books?.[linkedBookId])books[linkedBookId]=history.books[linkedBookId];
 }
 return{version:2,books,offers,priceHistory:[],updatedAt:history.updatedAt};
}
function syncHistoryToCatalog(history,selection){
 const catalog=getProductionCatalog();
 return catalog?importJsonV2Data(legacySyncSlice(history,selection),catalog.repository,{preserveExistingOffers:true}):null;
}

function recordProgress(event){const safe={at:new Date().toISOString(),...event};void appendFile(logPath,JSON.stringify(safe)+'\n').catch(()=>{});return safe;}
function streamHeaders(response,type='application/x-ndjson; charset=utf-8'){response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://covers.openlibrary.org; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});}
function historySnapshot(history){return{updatedAt:history.updatedAt,lastScan:history.lastScan,books:Object.values(history.books).map(book=>bookStatistics(history,book.id)).filter(Boolean).sort((a,b)=>String(b.book.lastSeenAt).localeCompare(String(a.book.lastSeenAt))),offers:analyzedOffers(history).sort((a,b)=>String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))};}
let historyWriteTail=Promise.resolve();
export async function withHistoryWriteLock(work){
  let release;
  const previous=historyWriteTail;
  historyWriteTail=new Promise(resolve=>{release=resolve});
  await previous;
  try{return await work();}finally{release();}
}

let runningCatalogResolution=null;
function scheduleCatalogResolution(catalogStore){
 if(runningCatalogResolution)return;
 runningCatalogResolution=new Promise(resolve=>setImmediate(resolve))
   .then(()=>catalogStore.processQueued())
   .then(result=>recordProgress({type:'catalog_resolution',processed:result.processed,failed:result.failed||0}))
   .catch(error=>recordProgress({type:'catalog_resolution_error',code:/^[A-Z0-9_]+$/.test(error?.message)?error.message:'CATALOG_INTEGRATION_ERROR'}))
   .finally(()=>{runningCatalogResolution=null;});
}

async function searchAndStore(input,onProgress=()=>{}){
 const history=await loadOfferHistory(),detailCache=new Map(Object.entries(history.details||{}).filter(([,detail])=>detail?.language||detail?.isbn)),result=await searchOffers(input,{onProgress,detailCache}),errors=result.results.filter(row=>row.status!=='ok').map(row=>({source:row.source,query:row.query,code:row.diagnostic?.code||'SOURCE_REQUEST_FAILED'}));
 const catalogStore=getProductionCatalog();
 const sqliteFirst=String(process.env.BOOKFLIP_SQLITE_FIRST??'0')==='1';
 const {applied,ids,ingest,catalogError}=await withHistoryWriteLock(async()=>{
  const fresh=await loadOfferHistory();
  return persistScannedOffers({
   history:fresh,offers:result.offers,searchedAt:result.searchedAt,
   detailCache,errors,catalogStore,sqliteFirst
  });
 });
 const offers=analyzedOffers(applied.history,ids).map(offer=>({...offer,title:offer.originalTitle}));
 let catalog=null;
 if(catalogStore){
  if(!catalogError&&String(process.env.BOOKFLIP_CATALOG_AUTO_RESOLVE??'1')!=='0')scheduleCatalogResolution(catalogStore);
  catalog=catalogError?{error:catalogError}:{ingest,resolution:{status:'queued'}};
 }
 return{...result,offers,summary:{...result.summary,newOffers:applied.summary.new,priceChanges:applied.summary.priceChanges},history:applied.summary,lastScan:applied.history.lastScan,...(catalog?{catalog}:{})};
}

function validateLocalRequest(request) {
  const expectedPort=String(request.socket.localPort || 4317);
  const allowedHosts=new Set([`127.0.0.1:${expectedPort}`,`localhost:${expectedPort}`]);
  const host=String(request.headers.host||'').toLowerCase();
  if(!allowedHosts.has(host))return {status:403,error:'INVALID_HOST'};
  const origin=request.headers.origin;
  if(origin){
    let parsed;
    try{parsed=new URL(origin);}catch{return {status:403,error:'INVALID_ORIGIN'};}
    if(parsed.protocol!=='http:' || !allowedHosts.has(parsed.host.toLowerCase()))return {status:403,error:'INVALID_ORIGIN'};
  }
  if(['POST','PUT','PATCH','DELETE'].includes(request.method)){
    if(!origin)return {status:403,error:'ORIGIN_REQUIRED'};
    const type=String(request.headers['content-type']||'').split(';',1)[0].trim().toLowerCase();
    if(type!=='application/json')return {status:415,error:'JSON_REQUIRED'};
  }
  return null;
}

export function createLocalAppServer(){return createServer(async(request,response)=>{try{
 const rejected=validateLocalRequest(request);
 if(rejected)return send(response,rejected.status,JSON.stringify({error:rejected.error}));
 const url=new URL(request.url||'/','http://127.0.0.1');
 if(request.method==='GET'&&url.pathname==='/api/sources')return send(response,200,JSON.stringify({sources:Object.keys(localSourceHosts)}));
 if(request.method==='GET'&&url.pathname==='/api/history'){const history=await loadOfferHistory();return send(response,200,JSON.stringify(historySnapshot(history)));}
 if(request.method==='GET'&&url.pathname==='/api/book'){const history=await loadOfferHistory(),data=bookHistory(history,url.searchParams.get('id'));return data?send(response,200,JSON.stringify(data)):send(response,404,JSON.stringify({error:'BOOK_NOT_FOUND'}));}
 if(request.method==='POST'&&url.pathname==='/api/catalog'){const input=await readJson(request);const created=await withHistoryWriteLock(async()=>{const history=await loadOfferHistory(),next=createCatalogBook(history,input);await saveOfferHistory(next.history);return{...next,catalogSync:syncHistoryToCatalog(next.history,{bookId:next.book.id}),snapshot:historySnapshot(next.history)};});return send(response,created.created?201:200,JSON.stringify({book:created.book,catalog:created.snapshot,catalogSync:created.catalogSync}));}
 if(request.method==='GET'&&url.pathname==='/api/catalog/status'){const catalog=getProductionCatalog();return send(response,200,JSON.stringify(catalog?catalog.status():{enabled:false}));}
 if(request.method==='GET'&&url.pathname==='/api/catalog/works'){const catalog=getProductionCatalog();if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));return send(response,200,JSON.stringify(listCatalogWorks(catalog.repository,Object.fromEntries(url.searchParams))));}
 if(request.method==='GET'&&url.pathname.startsWith('/api/catalog/works/')){const catalog=getProductionCatalog(),id=decodeURIComponent(url.pathname.slice('/api/catalog/works/'.length));if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));const data=getCatalogWork(catalog.repository,id);return data?send(response,200,JSON.stringify(data)):send(response,404,JSON.stringify({error:'WORK_NOT_FOUND'}));}
 if(request.method==='GET'&&url.pathname.startsWith('/api/catalog/editions/')){const catalog=getProductionCatalog(),id=decodeURIComponent(url.pathname.slice('/api/catalog/editions/'.length));if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));const data=getCatalogEdition(catalog.repository,id);return data?send(response,200,JSON.stringify(data)):send(response,404,JSON.stringify({error:'EDITION_NOT_FOUND'}));}
 if(request.method==='GET'&&url.pathname==='/api/offers'){const catalog=getProductionCatalog();if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));return send(response,200,JSON.stringify(listCatalogOffers(catalog.repository,Object.fromEntries(url.searchParams))));}
 if(request.method==='GET'&&url.pathname.startsWith('/api/offers/')){const catalog=getProductionCatalog(),id=decodeURIComponent(url.pathname.slice('/api/offers/'.length));if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));const data=getCatalogOffer(catalog.repository,id);return data?send(response,200,JSON.stringify(data)):send(response,404,JSON.stringify({error:'OFFER_NOT_FOUND'}));}
 if(request.method==='GET'&&url.pathname==='/api/identification-jobs'){const catalog=getProductionCatalog();if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));return send(response,200,JSON.stringify(listIdentificationJobs(catalog.repository,Object.fromEntries(url.searchParams))));}
 if(request.method==='POST'&&/^\/api\/identification-jobs\/[^/]+\/decision$/.test(url.pathname)){const catalog=getProductionCatalog(),id=decodeURIComponent(url.pathname.split('/')[3]);if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));return send(response,200,JSON.stringify(decideIdentificationJob(catalog.repository,id,await readJson(request))));}
 if(request.method==='POST'&&url.pathname==='/api/catalog/lookup-preview'){const catalog=getProductionCatalog();if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));return send(response,200,JSON.stringify(await catalog.lookupIsbn((await readJson(request)).isbn)));}
 if(request.method==='POST'&&url.pathname==='/api/catalog/lookup-confirm'){const catalog=getProductionCatalog();if(!catalog)return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));const result=await catalog.resolveIsbn((await readJson(request)).isbn);return send(response,['created_edition','created_work_and_edition','matched_existing'].includes(result.decision)?200:409,JSON.stringify(result));}
 if(request.method==='POST'&&url.pathname==='/api/catalog/link'){const input=await readJson(request);const snapshot=await withHistoryWriteLock(async()=>{const history=linkOfferToBook(await loadOfferHistory(),String(input.offerId||''),String(input.bookId||''));await saveOfferHistory(history);syncHistoryToCatalog(history,{bookId:String(input.bookId||''),offerId:String(input.offerId||'')});return historySnapshot(history);});return send(response,200,JSON.stringify(snapshot));}
 if(request.method==='POST'&&url.pathname==='/api/search'&&url.searchParams.get('stream')==='1'){
  streamHeaders(response);const emit=event=>{const safe=recordProgress(event);response.write(JSON.stringify({type:'progress',event:safe})+'\n');};
  try{const result=await searchAndStore(await readJson(request),emit);response.write(JSON.stringify({type:'result',result})+'\n');response.end();}catch(error){response.write(JSON.stringify({type:'error',error:/^[A-Z0-9_]+$/.test(error.message)?error.message:'LOCAL_APP_ERROR'})+'\n');response.end();}return;
 }
 if(request.method==='POST'&&url.pathname==='/api/search')return send(response,200,JSON.stringify(await searchAndStore(await readJson(request))));
 if(request.method!=='GET')return send(response,405,JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
 const files={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js'},file=files[url.pathname];if(!file)return send(response,404,'Nie znaleziono','text/plain; charset=utf-8');
 const body=await readFile(join(appDirectory,file));return send(response,200,body,contentTypes[extname(file)]||'application/octet-stream');
 }catch(error){send(response,error.statusCode||500,JSON.stringify({error:/^[A-Z0-9_]+$/.test(error.message)?error.message:'LOCAL_APP_ERROR'}));}});}

function openLocalApp(url){if(process.platform==='win32'&&!process.argv.includes('--no-open'))spawn('cmd.exe',['/c','start','',url],{detached:true,stdio:'ignore',windowsHide:true}).unref();}
async function main(){const port=Number(process.env.BOOKFLIP_LOCAL_PORT||4317);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_PORT');const url=`http://127.0.0.1:${port}`,server=createLocalAppServer();server.on('error',error=>{if(error.code==='EADDRINUSE'){console.log(`BookFlip Scanner już działa pod adresem ${url}`);openLocalApp(url);process.exitCode=0;return;}console.error(error.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>{console.log(`BookFlip Scanner działa: ${url}`);openLocalApp(url);});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
