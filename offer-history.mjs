import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {extractOfferISBN} from './isbn.mjs';
import {normalizeISBN} from './isbn-normalization.mjs';
import {normalizeOfferUrl,offerExternalId,sourceOfferId} from './offer-identity.mjs';

export {normalizeOfferUrl,sourceOfferId} from './offer-identity.mjs';

export const defaultHistoryPath=join(process.cwd(),'scan-results','local-offer-history.json');

export function emptyOfferHistory(){return{version:2,updatedAt:null,books:{},offers:{},priceHistory:[],details:{},lastScan:null};}

export function normalizedIsbn(value){return normalizeISBN(value);}
function bookIdFor(isbn){return isbn?`isbn:${isbn}`:null;}
function validPrice(value){return Number.isSafeInteger(value)&&value>0&&value<=100000000;}

function migrateV1(old){
 const next=emptyOfferHistory();next.updatedAt=old.updatedAt||null;next.details={...(old.details||{})};
 for(const row of Object.values(old.offers||{})){
  if(!row?.url||!row.source)continue;let id;try{id=sourceOfferId(row.source,row.url);}catch{continue;}
  const isbn=normalizedIsbn(row.isbn),bookId=bookIdFor(isbn),prices=Array.isArray(row.prices)?row.prices:[];
  if(bookId)next.books[bookId]={id:bookId,title:String(row.title||'').slice(0,500),isbn,origin:'detected',firstSeenAt:row.firstSeenAt||prices[0]?.at||old.updatedAt,lastSeenAt:row.lastSeenAt||old.updatedAt};
  const currentPrice=prices.at(-1)?.price;
  next.offers[id]={id,bookId,linkMode:bookId?'detected':null,originalTitle:String(row.title||'').slice(0,500),currentPrice:validPrice(currentPrice)?currentPrice:null,source:row.source,url:normalizeOfferUrl(row.url),firstSeenAt:row.firstSeenAt||prices[0]?.at||old.updatedAt,lastSeenAt:row.lastSeenAt||old.updatedAt,availability:'unconfirmed',matchedQueries:[...new Set(row.matchedQueries||[])],isbn,language:row.language||null,seenCount:row.seenCount||prices.length||1};
  for(const point of prices)if(validPrice(point.price)&&point.at)next.priceHistory.push({offerId:id,price:point.price,observedAt:point.at});
 }
 return next;
}

export function migrateOfferHistory(value){
 if(value?.version===1&&value.offers&&value.details)return migrateV1(value);
 if(value?.version!==2||typeof value.books!=='object'||typeof value.offers!=='object'||!Array.isArray(value.priceHistory)||typeof value.details!=='object')throw Error('INVALID_HISTORY');
 return{...emptyOfferHistory(),...value,books:{...value.books},offers:{...value.offers},priceHistory:[...value.priceHistory],details:{...value.details}};
}

export async function loadOfferHistory(path=defaultHistoryPath){try{return migrateOfferHistory(JSON.parse(await readFile(path,'utf8')));}catch(error){if(error.code==='ENOENT')return emptyOfferHistory();throw error;}}

export function applyScanToHistory(history,offers,searchedAt,detailCache=new Map(),scan={}){
 const previous=migrateOfferHistory(history),next={...previous,version:2,updatedAt:searchedAt,books:{...previous.books},offers:{...previous.offers},priceHistory:[...previous.priceHistory],details:{...previous.details}};
 let newOffers=0,priceChanges=0;
 for(const [url,detail] of detailCache)if(detail?.language||detail?.isbn)next.details[url]={language:detail.language||null,isbn:normalizedIsbn(detail.isbn),checkedAt:searchedAt};
 for(const candidate of offers){
  if(!candidate?.source||!candidate?.url||!validPrice(candidate.price))continue;
  let url,id,old;try{url=normalizeOfferUrl(candidate.url);const preferred=sourceOfferId(candidate.source,url,offerExternalId(candidate)),legacy=sourceOfferId(candidate.source,url);id=next.offers[preferred]?preferred:next.offers[legacy]?legacy:preferred;old=next.offers[id];}catch{continue;}
  const detail=next.details[candidate.url]||next.details[url],evidence=extractOfferISBN(candidate),detailIsbn=evidence.status==='missing'?normalizedIsbn(detail?.isbn):null,isbn=evidence.autoAssignable?evidence.isbn:old?.isbn||detailIsbn,detectedBookId=bookIdFor(isbn),bookId=old?.linkMode==='manual'?old.bookId:evidence.autoAssignable?detectedBookId:old?.bookId||detectedBookId,title=String(candidate.title||old?.originalTitle||'').trim().slice(0,500);
  if(!old)newOffers++;
  if(!old||old.currentPrice!==candidate.price){next.priceHistory.push({offerId:id,price:candidate.price,observedAt:searchedAt});if(old)priceChanges++;}
  next.offers[id]={id,bookId,linkMode:old?.linkMode==='manual'?'manual':bookId?'detected':null,originalTitle:title,currentPrice:candidate.price,source:candidate.source,url,firstSeenAt:old?.firstSeenAt||searchedAt,lastSeenAt:searchedAt,availability:candidate.availability||'unconfirmed',matchedQueries:[...new Set([...(old?.matchedQueries||[]),...(candidate.matchedQueries||[])])],isbn:isbn||null,language:candidate.language||old?.language||detail?.language||null,seenCount:(old?.seenCount||0)+1};
  if(bookId){const oldBook=next.books[bookId];next.books[bookId]={id:bookId,title:oldBook?.title||title,isbn:oldBook?.isbn||isbn||null,origin:oldBook?.origin||'detected',firstSeenAt:oldBook?.firstSeenAt||searchedAt,lastSeenAt:searchedAt};}
 }
 const errors=Array.isArray(scan.errors)?scan.errors.map(row=>({source:row.source,query:row.query,code:row.code})):[];
 next.lastScan={at:searchedAt,found:offers.length,newOffers,priceChanges,errors};
 return{history:next,summary:{saved:Object.keys(next.offers).length,new:newOffers,priceChanges}};
}

export function updateOfferHistory(history,offers,searchedAt,detailCache=new Map(),scan={}){return applyScanToHistory(history,offers,searchedAt,detailCache,scan).history;}

export async function saveOfferHistory(history,path=defaultHistoryPath){
 await mkdir(dirname(path),{recursive:true});const temporary=`${path}.${process.pid}.${Date.now()}.tmp`;
 try{await writeFile(temporary,JSON.stringify(migrateOfferHistory(history),null,2)+'\n','utf8');await rename(temporary,path);}catch(error){await rm(temporary,{force:true}).catch(()=>{});throw error;}
}

export function historyList(history){return Object.values(migrateOfferHistory(history).offers).sort((a,b)=>String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));}

export function createCatalogBook(raw,{title,isbn=null},at=new Date().toISOString(),idFactory=randomUUID){
 const history=migrateOfferHistory(raw),cleanTitle=String(title||'').trim();if(!cleanTitle||cleanTitle.length>500)throw Object.assign(Error('INVALID_BOOK_TITLE'),{statusCode:400});
 const supplied=String(isbn||'').trim(),cleanIsbn=normalizedIsbn(supplied);if(supplied&&!cleanIsbn)throw Object.assign(Error('INVALID_BOOK_ISBN'),{statusCode:400});
 const id=cleanIsbn?bookIdFor(cleanIsbn):`book:${idFactory()}`,old=history.books[id],book=old?{...old,title:cleanTitle,lastSeenAt:old.lastSeenAt||at}:{id,title:cleanTitle,isbn:cleanIsbn,origin:'manual',firstSeenAt:at,lastSeenAt:at};
 return{history:{...history,updatedAt:at,books:{...history.books,[id]:book}},book,created:!old};
}

export function linkOfferToBook(raw,offerId,bookId,at=new Date().toISOString()){
 const history=migrateOfferHistory(raw),offer=history.offers[offerId];if(!offer)throw Object.assign(Error('OFFER_NOT_FOUND'),{statusCode:404});if(!history.books[bookId])throw Object.assign(Error('BOOK_NOT_FOUND'),{statusCode:404});
 return{...history,updatedAt:at,books:{...history.books,[bookId]:{...history.books[bookId],lastSeenAt:at}},offers:{...history.offers,[offerId]:{...offer,bookId,linkMode:'manual'}}};
}
