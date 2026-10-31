import {normalizeOfferUrl} from './offer-identity.mjs';

// Read-only migration gate. JSON and SQLite have different ownership semantics:
// this report never reconciles or overwrites either side.
export function compareHistoryStores(history,database,{sampleLimit=10}={}){
 if(history?.version!==2 || !history.offers || typeof history.offers!=='object')throw Error('INVALID_JSON_V2_HISTORY');
 if(!Number.isSafeInteger(sampleLimit)||sampleLimit<0||sampleLimit>100)throw Error('INVALID_SAMPLE_LIMIT');
 const sqlite=database.prepare('SELECT id,source,normalized_url,current_price,seen_count FROM offers').all();
 const json=Object.values(history.offers);
 const keyOf=(source,url)=>{try{return String(source||'')+'\u0000'+normalizeOfferUrl(url);}catch{return null;}};
 const indexed=new Map(),invalidSqlite=[];
 for(const row of sqlite){
  const key=keyOf(row.source,row.normalized_url);
  if(!key){invalidSqlite.push(row.id);continue;}
  if(!indexed.has(key))indexed.set(key,[]);
  indexed.get(key).push(row);
 }
 const matched=new Set(),missingInSqlite=[],invalidJson=[],priceDifferences=[],seenCountDifferences=[],ambiguous=[];
 for(const offer of json){
  const key=keyOf(offer.source,offer.url);
  if(!key){invalidJson.push(String(offer.id||''));continue;}
  const candidates=indexed.get(key)||[];
  if(!candidates.length){missingInSqlite.push(String(offer.id||key));continue;}
  if(candidates.length>1){ambiguous.push(String(offer.id||key));continue;}
  const row=candidates[0];matched.add(row.id);
  const jsonPrice=Number(offer.currentPrice),sqlitePrice=Number(row.current_price);
  if(Number.isFinite(jsonPrice)&&jsonPrice!==sqlitePrice)priceDifferences.push({offerId:String(offer.id||''),jsonPrice,sqlitePrice});
  if(Number.isSafeInteger(offer.seenCount)&&offer.seenCount!==Number(row.seen_count))seenCountDifferences.push({offerId:String(offer.id||''),jsonSeen:offer.seenCount,sqliteSeen:Number(row.seen_count)});
 }
 const sqliteOnly=sqlite.filter(row=>!matched.has(row.id));
 const summary={
  jsonOffers:json.length,sqliteOffers:sqlite.length,matched:matched.size,
  missingInSqlite:missingInSqlite.length,sqliteOnly:sqliteOnly.length,
  priceDifferences:priceDifferences.length,seenCountDifferences:seenCountDifferences.length,
  invalidJsonUrls:invalidJson.length,invalidSqliteUrls:invalidSqlite.length,ambiguousMatches:ambiguous.length
 };
 return {
  format:'bookflip-history-parity-v1',
  // A SQLite-only record can be a legitimate newer scan. The gate is therefore
  // a diagnostic, not an automatic authority choice.
  safeToCutOver:summary.missingInSqlite===0&&summary.priceDifferences===0&&summary.invalidJsonUrls===0&&summary.invalidSqliteUrls===0&&summary.ambiguousMatches===0,
  summary,
  samples:{
   missingInSqlite:missingInSqlite.slice(0,sampleLimit),
   sqliteOnly:sqliteOnly.slice(0,sampleLimit).map(row=>row.id),
   priceDifferences:priceDifferences.slice(0,sampleLimit),
   seenCountDifferences:seenCountDifferences.slice(0,sampleLimit),
   invalidJsonUrls:invalidJson.slice(0,sampleLimit),
   invalidSqliteUrls:invalidSqlite.slice(0,sampleLimit),
   ambiguousMatches:ambiguous.slice(0,sampleLimit)
  }
 };
}
