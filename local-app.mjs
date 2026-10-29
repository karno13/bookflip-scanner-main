import {createServer} from 'node:http';
import {readFile,appendFile} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {scanMarketplace} from './marketplaces.mjs';
import {localSourceHosts} from './local-scan.mjs';
import {readVintedLanguage} from './vinted-detail.mjs';
import {loadOfferHistory,saveOfferHistory,applyScanToHistory,sourceOfferId} from './offer-history.mjs';
import {analyzedOffers,bookHistory,bookStatistics} from './price-analysis.mjs';

const appDirectory=fileURLToPath(new URL('./app/',import.meta.url));
const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};

export function validateSearchInput(input){
 const queries=[...new Set((Array.isArray(input?.queries)?input.queries:[]).map(value=>String(value).trim()).filter(Boolean))];
 const sources=[...new Set((Array.isArray(input?.sources)?input.sources:[]).map(String))];
 if(!queries.length||queries.length>10||queries.some(query=>query.length>120))throw Object.assign(Error('INVALID_QUERIES'),{statusCode:400});
 if(!sources.length||sources.length>Object.keys(localSourceHosts).length||sources.some(source=>!localSourceHosts[source]))throw Object.assign(Error('INVALID_SOURCES'),{statusCode:400});
 return{queries,sources};
}

export async function searchOffers(input,{scanner=scanMarketplace,languageReader=readVintedLanguage,now=()=>new Date(),onProgress=()=>{},detailCache=new Map()}={}){
 const {queries,sources}=validateSearchInput(input),results=[],languageCache=detailCache;
 await Promise.all(sources.map(async source=>{
  for(const query of queries){const task={source,host:localSourceHosts[source],mode:'discovery',title:query,category:query,language:'pl',searchQuery:query,page:1,paginationVersion:1};
   onProgress({type:'source-start',source,query});
   try{const scan=await scanAllPages(task,scanner,event=>onProgress({...event,source,query}));let offers=scan.offers;if(source==='Vinted'&&task.language==='pl'){onProgress({type:'language-start',source,query,count:offers.length});offers=await filterVintedPolishOffers(offers,languageReader,(event)=>onProgress({...event,source,query}),languageCache);}results.push({source,query,status:'ok',offers,pagination:scan.pagination,pages:scan.pages});onProgress({type:'source-done',source,query,offers:offers.length,pages:scan.pages.length});}
   catch(error){onProgress({type:'source-error',source,query,code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'SOURCE_REQUEST_FAILED'});results.push({source,query,status:'unavailable',offers:[],diagnostic:{code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'SOURCE_REQUEST_FAILED',httpStatus:Number.isInteger(error.status)?error.status:null,blocked:error.blocked===true,retryable:error.retryable===true}});}
  }
 }));
 const offersByUrl=new Map();
 for(const row of results){for(const offer of row.offers){const existing=offersByUrl.get(offer.url);if(existing){if(!existing.matchedQueries.includes(row.query))existing.matchedQueries.push(row.query);continue;}offersByUrl.set(offer.url,{...offer,source:row.source,matchedQueries:[row.query]});}}
 const offers=[...offersByUrl.values()].sort((a,b)=>a.price-b.price||a.title.localeCompare(b.title,'pl'));
 return{searchedAt:now().toISOString(),category:'books',language:'pl',queries,sources,summary:{offers:offers.length,successful:results.filter(row=>row.status==='ok').length,unavailable:results.filter(row=>row.status!=='ok').length},offers,results:results.map(({offers,...row})=>({...row,count:offers.length}))};
}
async function scanAllPages(task,scanner,onProgress=()=>{}){const offers=[],seenPages=new Set(),pages=[];let current={...task};for(let attempt=0;attempt<50;attempt++){if(seenPages.has(current.page))throw Error('PAGINATION_LOOP');seenPages.add(current.page);onProgress({type:'page-start',page:current.page});const scan=await scanner(current);offers.push(...scan.offers);pages.push({page:current.page,count:scan.offers.length,state:scan.pagination?.state||'unknown'});onProgress({type:'page-done',page:current.page,count:scan.offers.length,state:scan.pagination?.state||'unknown',total:offers.length});const next=scan.pagination?.nextPage;if(scan.pagination?.state!=='more'||!Number.isInteger(next)||next<=current.page)break;current={...current,page:next};}return{offers,pagination:pages.at(-1)?.state==='more'?{state:'limit',nextPage:current.page}:pages.at(-1),pages};}
async function filterVintedPolishOffers(offers,languageReader,onProgress=()=>{},cache=new Map()){offers=[...new Map(offers.map(offer=>[offer.url,offer])).values()];const accepted=[];let checked=0,unknown=0,cached=0;for(const offer of offers){try{let detail=cache.get(offer.url);if(detail)cached++;else{detail=await languageReader(offer.url);cache.set(offer.url,detail);}checked++;if(/^(?:pl|pol|polish|polski|język polski)$/i.test(String(detail.language||'')))accepted.push({...offer,language:'Polski',...(detail.isbn?{isbn:detail.isbn,isbnEvidence:'Vinted — szczegóły oferty'}:{})});else if(!detail.language)unknown++;onProgress({type:'language-progress',checked,total:offers.length,accepted:accepted.length,unknown,cached});}catch(error){if(error.blocked||[403,429].includes(error.status))throw error;checked++;unknown++;onProgress({type:'language-progress',checked,total:offers.length,accepted:accepted.length,unknown,cached});}}return accepted;}

async function readJson(request){let size=0,text='';for await(const chunk of request){size+=chunk.length;if(size>32768)throw Object.assign(Error('REQUEST_TOO_LARGE'),{statusCode:413});text+=chunk;}try{return JSON.parse(text||'{}');}catch{throw Object.assign(Error('INVALID_JSON'),{statusCode:400});}}
function send(response,status,body,type='application/json; charset=utf-8'){response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});response.end(body);}
const logPath=join(process.cwd(),'scan-results','local-app.log');
function recordProgress(event){const safe={at:new Date().toISOString(),...event};void appendFile(logPath,JSON.stringify(safe)+'\n').catch(()=>{});return safe;}
function streamHeaders(response,type='application/x-ndjson; charset=utf-8'){response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});}
function historySnapshot(history){return{updatedAt:history.updatedAt,lastScan:history.lastScan,books:Object.values(history.books).map(book=>bookStatistics(history,book.id)).filter(Boolean).sort((a,b)=>String(b.book.lastSeenAt).localeCompare(String(a.book.lastSeenAt))),offers:analyzedOffers(history).sort((a,b)=>String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))};}
async function searchAndStore(input,onProgress=()=>{}){
 const history=await loadOfferHistory(),detailCache=new Map(Object.entries(history.details||{}).filter(([,detail])=>detail?.language||detail?.isbn)),result=await searchOffers(input,{onProgress,detailCache}),errors=result.results.filter(row=>row.status!=='ok').map(row=>({source:row.source,query:row.query,code:row.diagnostic?.code||'SOURCE_REQUEST_FAILED'})),applied=applyScanToHistory(history,result.offers,result.searchedAt,detailCache,{errors});
 await saveOfferHistory(applied.history);const ids=result.offers.map(offer=>sourceOfferId(offer.source,offer.url)),offers=analyzedOffers(applied.history,ids).map(offer=>({...offer,title:offer.originalTitle}));
 return{...result,offers,summary:{...result.summary,newOffers:applied.summary.new,priceChanges:applied.summary.priceChanges},history:applied.summary,lastScan:applied.history.lastScan};
}

export function createLocalAppServer(){return createServer(async(request,response)=>{try{
 const url=new URL(request.url||'/','http://127.0.0.1');
 if(request.method==='GET'&&url.pathname==='/api/sources')return send(response,200,JSON.stringify({sources:Object.keys(localSourceHosts)}));
 if(request.method==='GET'&&url.pathname==='/api/history'){const history=await loadOfferHistory();return send(response,200,JSON.stringify(historySnapshot(history)));}
 if(request.method==='GET'&&url.pathname==='/api/book'){const history=await loadOfferHistory(),data=bookHistory(history,url.searchParams.get('id'));return data?send(response,200,JSON.stringify(data)):send(response,404,JSON.stringify({error:'BOOK_NOT_FOUND'}));}
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
