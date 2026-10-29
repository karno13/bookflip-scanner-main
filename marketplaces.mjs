import {queryText,matchesTopic,excludesProduct} from './search-policy.mjs';
import {bibliographicMetadata} from './isbn.mjs';
import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {parseVinted,parseAllegroListing,parseOlx,rscText,objectAt} from './reference-parsers.mjs';
const sources={Allegro:{host:'allegro.pl',path:'/oferta/'},Empik:{host:'www.empik.com',path:null},Vinted:{host:'www.vinted.pl',path:'/items/'},'Allegro Lokalnie':{host:'allegrolokalnie.pl',path:'/oferta/'},OLX:{host:'www.olx.pl',path:'/d/oferta/'},'Tezeusz.pl':{host:'tezeusz.pl',path:null},'Dedalus.pl':{host:'dedalus.pl',path:null}};
const norm=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/[^a-z0-9]+/g,' ').trim();
export function acceptsBook(task,title){if(excludesProduct(title))return false;return matchesTopic(task,title);}
export function searchUrl(task){if(!sources[task.source]||task.host!==sources[task.source].host)throw Error('UNTRUSTED_MARKETPLACE_TASK');const query=queryText(task);if(task.source==='Vinted'){const u=new URL('https://www.vinted.pl/catalog/2312-books');u.searchParams.set('search_text',query);if(task.paginationVersion===1){if(!Number.isInteger(task.page)||task.page<1||task.page>10000)throw Error('INVALID_VINTED_PAGE');u.searchParams.set('page',String(task.page));}return u.href;}if(task.paginationVersion===1&&(!Number.isInteger(task.page)||task.page<1||task.page>10000))throw Error('INVALID_MARKETPLACE_PAGE');let u;if(task.source==='Allegro'){u=new URL('https://allegro.pl/listing');u.searchParams.set('string',task.mode==='watchlist'?query:query+' książki');}else if(task.source==='Empik'){u=new URL('https://www.empik.com/szukaj/produkt');u.searchParams.set('q',query);u.searchParams.set('qtype','basicForm');}else if(task.source==='Allegro Lokalnie')u=new URL('https://allegrolokalnie.pl/oferty/q/'+encodeURIComponent(task.mode==='watchlist'?query:query+' książki'));else if(task.source==='OLX')u=new URL('https://www.olx.pl/muzyka-edukacja/ksiazki/q-'+encodeURIComponent(query)+'/');else if(task.source==='Tezeusz.pl'){u=new URL('https://tezeusz.pl/szukaj');u.searchParams.set('szukaj',query);}else{u=new URL('https://dedalus.pl/s');u.searchParams.set('q',query);}if(task.paginationVersion===1&&task.page>1)u.searchParams.set(task.source==='Allegro'?'p':task.source==='Empik'?'start':'page',String(task.source==='Empik'?(task.page-1)*60+1:task.page));return u.href;}
export function retryAfterSeconds(header,now=Date.now()){
 const text=String(header||'').trim(),seconds=/^\d+$/.test(text)?Number(text):(Date.parse(text)-now)/1000;
 return Number.isFinite(seconds)&&seconds>=0?Math.min(86400,Math.max(30,Math.ceil(seconds))):30;
}
const lastReads=new Map();
export function sourceChallenge(html){
 // Embedded form integrations are not access challenges. Inspect visible markup,
 // while retaining explicit challenge-provider endpoints even inside scripts.
 const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ');
 return /verify (?:that )?you are human|access denied|just a moment\.\.\.|attention required|<title>[^<]*(?:captcha|verification)|potwierd[zź],? [zż]e jeste[sś] cz[lł]owiekiem/i.test(markup)
  || /\/cdn-cgi\/challenge-platform\/|(?:geo\.)?captcha-delivery\.com\/(?:captcha|interstitial)\/|ct\.captcha-delivery\.com\/c\.js|\bvar\s+dd\s*=\s*\{[^}]*\bhost\s*:\s*['"]geo\.captcha-delivery\.com/i.test(html)
  || html.length<100000&&/captcha|datadome.*challenge/i.test(markup);
}
async function readBody(response,limit=4000000){
 if(!response.body)return '';
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('SOURCE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(buffer);
}
export async function readSourceHtml(raw,{fetcher=fetch,source,pause=wait,now=Date.now}={}){
 const config=sources[source];if(!config)throw Error('UNTRUSTED_MARKETPLACE_TASK');const allowed=h=>h===config.host||h===config.host.replace(/^www\./,'');let url=new URL(raw);const signal=AbortSignal.timeout(18000);
 for(let hop=0;hop<4;hop++){
  if(url.protocol!=='https:'||!allowed(url.hostname)||url.username||url.password||url.port)throw Error('UNSAFE_SOURCE_REDIRECT');
  await pause(Math.max(0,(lastReads.get(source)||0)+2000-now()),undefined,{signal});lastReads.set(source,now());
  const response=await fetcher(url,{headers:{Accept:'text/html','User-Agent':'BookFlip/1.0 (book price comparison)'},redirect:'manual',signal});
  if([403,429].includes(response.status)){
   const retryAfter=retryAfterSeconds(response.headers.get('retry-after'),now());
   if(response.status===403){let html;try{html=await readBody(response,100000);}catch{throw Object.assign(Error('SOURCE_FORBIDDEN_UNREADABLE'),{blocked:true,status:403,retryAfter});}if(sourceChallenge(html))throw Object.assign(Error('SOURCE_CAPTCHA'),{blocked:true,status:403,retryAfter});}
   else await response.body?.cancel();
   throw Object.assign(Error('SOURCE_HTTP_'+response.status),{status:response.status,blocked:false,retryable:true,retryAfter});
  }
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('SOURCE_REDIRECT_MISSING');url=new URL(location,url);continue;}
  if(!response.ok){await response.body?.cancel();const retryable=response.status===408||response.status===425||response.status>=500;throw Object.assign(Error('SOURCE_HTTP_'+response.status),{status:response.status,retryable,...(retryable?{retryAfter:retryAfterSeconds(response.headers.get('retry-after'),now())}:{})});}
  if(!/text\/html|application\/xhtml/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw Error('SOURCE_NOT_HTML');}
  const html=await readBody(response);
  if(sourceChallenge(html))throw Object.assign(Error('SOURCE_CAPTCHA'),{blocked:true,status:response.status});
  return html;
 }throw Error('SOURCE_REDIRECT_LIMIT');
}
export function parseMarketplace(html,task,observedAt=new Date().toISOString(),limit=20){
 searchUrl(task);const book={accept:title=>acceptsBook(task,title)};let rows;
 try{if(task.source==='Vinted')rows=parseVinted(html,book,observedAt);else if(task.source==='Allegro Lokalnie')rows=parseAllegroListing(html,book,observedAt);else if(['Tezeusz.pl','Dedalus.pl','Allegro','Empik'].includes(task.source))rows=parseBookstore(html,book,task.source);else{
  let recognized=false;for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const d=JSON.parse(m[1]);if(Array.isArray(d.offers?.offers))recognized=true;}catch{}}
  if(!recognized)throw Error('UNRECOGNIZED_MARKETPLACE_DATA');rows=parseOlx(html,book,observedAt);
 }}catch(e){if(e.message==='UNRECOGNIZED_MARKETPLACE_DATA')throw e;throw Error('UNRECOGNIZED_MARKETPLACE_DATA');}
 const out=[],seen=new Set();for(const row of rows){if(row.available===false&&row.availabilityKnown!==false)continue;let u;try{u=new URL(row.url);}catch{continue;}if(u.protocol!=='https:'||![task.host,task.host.replace(/^www\./,'')].includes(u.hostname)||u.username||u.password||u.port||(sources[task.source].path&&!u.pathname.startsWith(sources[task.source].path))||(['Tezeusz.pl','Dedalus.pl','Allegro','Empik'].includes(task.source)&&/^\/(?:szukaj|s|do-koszyka|do-schowka|koszyk|logowanie|info|tanie-ksiazki(?=\/?$))(?:\/|$)/i.test(u.pathname)))continue;
  if(task.source==='Vinted'&&!/^\/items\/\d+/.test(u.pathname))continue;
  u.search='';u.hash='';if(seen.has(u.href))continue;seen.add(u.href);const price=Math.round(row.price*100);if(!Number.isSafeInteger(price)||price<=0||price>100000000)continue;
  out.push({...bibliographicMetadata(row),title:row.title.slice(0,500),url:u.href,price,observedAt,activeConfirmed:false,priceConfirmed:false,availability:'unconfirmed',priceEvidence:'marketplace_listing'});if(out.length===limit)break;
 }return out;
}
function decodeHtml(s){return String(s||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(Math.min(parseInt(n,16),0x10ffff)));}
function textOnly(s){return decodeHtml(String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
function attribute(attrs,name){const match=String(attrs).match(new RegExp('\\b'+name+'\\s*=\\s*(?:"([^"]*)"|\\\'([^\\\']*)\\\')','i'));return decodeHtml(match?.[1]??match?.[2]??'');}
function parseEmpikCards(html,add){
 const starts=[...html.matchAll(/<div\b([^>]*)>/gi)].filter(match=>{const classes=attribute(match[1],'class').split(/\s+/);return classes.includes('search-list-item')&&classes.includes('ta-product-tile');});
 if(!starts.length){const recognized=[...html.matchAll(/<div\b([^>]*)>/gi)].some(match=>{const classes=attribute(match[1],'class').split(/\s+/);return classes.includes('search-content')&&classes.includes('js-search-content')&&attribute(match[1],'itemtype')==='https://schema.org/ItemList';});return recognized?[]:null;}
 for(let index=0;index<starts.length;index++){
  const root=starts[index],attrs=root[1],end=Math.min(starts[index+1]?.index??html.length,root.index+50000),segment=html.slice(root.index,end),productId=attribute(attrs,'data-product-id');
  if(!/^p\d+$/.test(productId))continue;
  let title=textOnly(attribute(attrs,'data-product-name'));
  if(!title){for(const match of segment.matchAll(/<strong\b([^>]*)>([\s\S]*?)<\/strong>/gi)){if(attribute(match[1],'itemprop')==='name'){title=textOnly(match[2]);break;}}}
  let rawUrl='';for(const match of segment.matchAll(/<a\b([^>]*)>/gi)){const candidate=attribute(match[1],'href'),id=attribute(match[1],'data-product-id');if(id&&id!==productId)continue;let url;try{url=new URL(candidate,'https://www.empik.com');}catch{continue;}const pathId=url.pathname.match(/,p(\d+),ksiazka-p$/i)?.[1];if(pathId&&'p'+pathId===productId){rawUrl=url.href;break;}}
  const priceTag=[...segment.matchAll(/<(?:meta|div|span)\b([^>]*)>/gi)].find(match=>attribute(match[1],'itemprop')==='price'),price=attribute(priceTag?.[1],'content'),declared=attribute(attrs,'data-product-price');
  const currencyTag=[...segment.matchAll(/<meta\b([^>]*)>/gi)].find(match=>attribute(match[1],'itemprop')==='priceCurrency'),currency=attribute(currencyTag?.[1],'content');
  const numeric=Number(String(price).replace(',','.')),declaredNumeric=declared?Number(declared.replace(',','.')):numeric;
  if(!rawUrl||!price||currency!=='PLN'||!Number.isFinite(numeric)||!Number.isFinite(declaredNumeric)||Math.abs(numeric-declaredNumeric)>0.001)continue;
  add(title,rawUrl,price,currency);
 }
 return true;
}
function parseBookstore(html,book,source){
 const host=sources[source].host,rows=[],seen=new Set();
 const add=(title,rawUrl,price,currency='PLN')=>{let url;try{url=new URL(rawUrl,'https://'+host);}catch{return;}if(source==='Allegro'&&!/^\/oferta\/[^/]+-\d+$/.test(url.pathname))return;if(source==='Empik'&&!/,p\d+,ksiazka-p$/.test(url.pathname))return;if(url.protocol!=='https:'||url.hostname!==host||url.port||url.username||url.password||/^\/(?:szukaj|s|do-koszyka|do-schowka|koszyk|logowanie|info|tanie-ksiazki(?=\/?$))(?:\/|$)/i.test(url.pathname)||!title||!book.accept(title)||currency!=='PLN')return;const amount=Number(String(price).replace(/\s/g,'').replace(',','.'));if(!Number.isFinite(amount)||amount<=0||amount>100000)return;url.search='';url.hash='';if(seen.has(url.href))return;seen.add(url.href);rows.push({title,url:url.href,price:amount,available:true});};
 // Tezeusz cards contain variant counts and old prices; read only the
 // current-price element within the same product anchor.
 if(source==='Tezeusz.pl'&&/tezeusz-product-card/.test(html)){
  for(const m of html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\btezeusz-product-card\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)){
   const href=m[1].match(/\bhref=["']([^"']+)["']/i)?.[1],card=m[2];
   const title=card.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1];
   const price=card.match(/<div\b[^>]*\bclass=["']tezeusz-product-card-price["'][^>]*>\s*([^<]+)/i)?.[1];
   const amount=price&&textOnly(price).match(/^(\d+(?:[ \u00a0]\d{3})*(?:[,.]\d{2})?)\s*(?:zł|PLN)$/i);
   if(href&&title&&amount)add(textOnly(title),decodeHtml(href),amount[1]);
  }
  return rows;
 }
 if(source==='Dedalus.pl'&&/Niestety, nie znaleźliśmy produktów, których szukasz\./i.test(textOnly(html)))return rows;
 if(source==='Empik'){
  const cards=parseEmpikCards(html,add);
  if(cards!==null)return rows;
 }
 const products=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}const type=Array.isArray(node['@type'])?node['@type']:[node['@type']];if(type.some(x=>['Product','Book'].includes(x)))products.push(node);for(const k of ['@graph','itemListElement','item'])visit(node[k]);};
 for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{
  // Dedalus emits literal newlines inside JSON-LD descriptions. Escape only
  // control characters inside strings; never evaluate page JavaScript.
  const json=source==='Dedalus.pl'?m[1].replace(/"(?:[^"\\]|\\[\s\S])*"/g,value=>value.replace(/[\u0000-\u001f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))):m[1];
  visit(JSON.parse(json));
 }catch{}
 for(const p of products){const offer=Array.isArray(p.offers)?p.offers[0]:p.offers;if(!offer||offer['@type']==='AggregateOffer')continue;const price=offer.price??offer.lowPrice,currency=offer.priceCurrency||'PLN';if(offer.lowPrice!=null&&offer.price==null)continue;add(p.name||p.title,offer.url||p.url||p['@id'],price,currency);}
 if(['Allegro','Empik'].includes(source)){if(!products.length)throw Error('UNRECOGNIZED_MARKETPLACE_DATA');return rows;}
 if(rows.length||products.length)return rows;
 const anchors=[...html.matchAll(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)].filter(m=>{try{const u=new URL(decodeHtml(m[2]),'https://'+host);return u.hostname===host&&/^https?:$/.test(u.protocol)&&!/^\/(?:szukaj|s|do-koszyka|do-schowka|koszyk|logowanie|info|tanie-ksiazki(?=\/?$))(?:\/|$)/i.test(u.pathname);}catch{return false;}});
 if(!anchors.length)throw Error('UNRECOGNIZED_MARKETPLACE_DATA');
 const seenUrls=new Set();for(let i=0;i<anchors.length;i++){const a=anchors[i],url=decodeHtml(a[2]);if(seenUrls.has(url))continue;seenUrls.add(url);let next=i+1;while(next<anchors.length&&decodeHtml(anchors[next][2])===url)next++;const segment=html.slice(a.index,anchors[next]?.index??Math.min(html.length,a.index+5000)),attrs=a[1];let title=attrs.match(/\btitle=["']([^"']+)["']/i)?.[1]||attrs.match(/\baria-label=["']([^"']+)["']/i)?.[1]||a[3].match(/<img\b[^>]*\balt=["']([^"']+)/i)?.[1]||textOnly(a[3]);title=textOnly(title);if(!title)continue;let price=null,currency='PLN';const micro=segment.match(/itemprop=["']price["'][^>]*content=["']([^"']+)/i)||segment.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);if(micro)price=micro[1];if(price==null){const match=textOnly(segment).match(/(?:^|\s)(\d{1,5}(?:[\s\u00a0]\d{3})*(?:[,.]\d{2})?)\s*(?:zł|PLN)(?:\s|$)/i);if(match)price=match[1];}if(price!=null)add(title,url,price,currency);}
 if(!rows.length&&/<(?:article|li|div)\b[^>]*(?:product|product-item|productbox|search-product)/i.test(html))return rows;
 if(!rows.length)throw Error('UNRECOGNIZED_MARKETPLACE_DATA');return rows;
}
export function vintedPageInfo(html,task){
 const page=task.page||1,data=rscText(html),ids=[];
 for(const m of data.matchAll(/"productItem"\s*:\s*\{/g)){const p=objectAt(data,m.index+m[0].length-1);if(p?.url)ids.push(p.url);}
 const digest=createHash('sha256').update(JSON.stringify([...new Set(ids)])).digest('hex');
 for(const m of data.matchAll(/"pagination"\s*:\s*\{/g)){const p=objectAt(data,m.index+m[0].length-1);if(!p)continue;const current=p.currentPage??p.current_page,total=p.totalPages??p.total_pages;if(Number.isInteger(current)&&Number.isInteger(total)&&current>0&&total>=current){if(current!==page)throw Error('VINTED_PAGE_NOT_MATCHED');return{page,digest,state:current<total?'more':'end',nextPage:current<total?current+1:null,totalPages:total};}}
 const current=new URL(searchUrl(task));
 for(const m of html.matchAll(/<(?:a|link)\b([^>]*)>/gi)){const attrs=m[1];if(!/\bnext\b|nast[eę]pn/i.test(attrs)||/aria-disabled=["']true|\bdisabled\b/i.test(attrs))continue;const href=attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];if(!href)continue;try{const u=new URL(href.replace(/&amp;/g,'&'),current);if(u.origin===current.origin&&u.pathname===current.pathname&&u.searchParams.get('search_text')===current.searchParams.get('search_text')&&Number(u.searchParams.get('page'))===page+1)return{page,digest,state:'more',nextPage:page+1};}catch{}}
 return{page,digest,state:'unknown',nextPage:null};
}
export function marketplacePageInfo(html,task,offers){
 if(task.source==='Vinted')return vintedPageInfo(html,task);
 const current=new URL(searchUrl(task)),page=task.page||1;
 const digest=createHash('sha256').update(JSON.stringify(offers.map(o=>o.url))).digest('hex');
 let ended=false;
 for(const m of html.matchAll(/<(?:a|link|button)\b([^>]*)>([^<]*)/gi)){
  const attrs=m[1],label=m[2];if(!/\brel=["'][^"']*\bnext\b|\baria-label=["'][^"']*(?:next|nast[eę]pn)/i.test(attrs)&&!/^\s*(?:next|nast[eę]pn)/i.test(label))continue;
  if(/aria-disabled=["']true|\bdisabled(?:[\s=>]|$)/i.test(attrs)){ended=true;continue;}
  const href=attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];if(!href)continue;
  try{const u=new URL(href.replace(/&amp;/g,'&'),current),parameter=task.source==='Allegro'?'p':task.source==='Empik'?'start':'page',rawNext=Number(u.searchParams.get(parameter)),next=task.source==='Empik'?((rawNext-1)/60+1):rawNext;u.searchParams.delete(parameter);const base=new URL(current);base.searchParams.delete(parameter);
   let sameQuery=true;if(task.source==='Empik'){sameQuery=norm(u.searchParams.get('q'))===norm(base.searchParams.get('q'))&&String(u.searchParams.get('qtype')||'').trim()===String(base.searchParams.get('qtype')||'').trim();u.searchParams.delete('q');u.searchParams.delete('qtype');base.searchParams.delete('q');base.searchParams.delete('qtype');}u.searchParams.sort();base.searchParams.sort();
   if(!u.username&&!u.password&&sameQuery&&u.href===base.href&&next===page+1)return{page,digest,state:'more',nextPage:next};
  }catch{}
 }
 return{page,digest,state:ended?'end':'unknown',nextPage:null};
}
export async function scanMarketplace(task,options={}){
 const html=await readSourceHtml(searchUrl(task),{...options,source:task.source}),paginated=task.paginationVersion===1;
 const offers=parseMarketplace(html,task,new Date().toISOString(),paginated?5001:20);if(offers.length>5000)throw Error('MARKETPLACE_PAGE_TOO_LARGE');
 const pagination=paginated?{...marketplacePageInfo(html,task,offers),total:offers.length}:undefined;
 return{offers,pagination,coverage:paginated?`${task.source}: strona ${task.page}, ${offers.length} pasujących wpisów. Cała odczytana strona zapisywana partiami. ${pagination.state==='end'?'Źródło wskazało koniec wyników.':pagination.state==='more'?'Potwierdzono kolejną stronę.':'Nie rozpoznano kolejnej strony; zakres niepełny.'} Dostępność, wydanie i koszty wymagają sprawdzenia. Zmiany kolejności mogą powodować pominięcia.`:'Jedna strona wyszukiwania, maksymalnie 20 kandydatów. Dostępność, cena szczegółowa, wydanie i koszty wymagają sprawdzenia. Zakres niepełny.'};
}
