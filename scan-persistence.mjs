import {randomUUID} from 'node:crypto';
import {applyScanToHistory,saveOfferHistory,sourceOfferId} from './offer-history.mjs';
import {offerExternalId} from './offer-identity.mjs';

// First transition stage: SQLite commits before the legacy JSON mirror.
// If the SQLite transaction fails, the JSON file is never touched.
// The two stores are NOT an atomic transaction; JSON mirror failures are
// surfaced as errors and must be reconciled before disabling JSON.
export async function persistScannedOffers({
 history,offers,searchedAt,detailCache=new Map(),errors=[],catalogStore,
 saveHistory=saveOfferHistory,sqliteFirst=false
}){
 const applied=applyScanToHistory(history,offers,searchedAt,detailCache,{errors});
 const ids=offers.map(offer=>{
  const preferred=sourceOfferId(offer.source,offer.url,offerExternalId(offer));
  const legacy=sourceOfferId(offer.source,offer.url);
  return applied.history.offers[preferred]?preferred:legacy;
 });
 const observations=offers.map((offer,index)=>({
  ...offer,
  seenCount:applied.history.offers[ids[index]]?.seenCount,
  firstSeenAt:applied.history.offers[ids[index]]?.firstSeenAt,
  lastSeenAt:applied.history.offers[ids[index]]?.lastSeenAt
 }));
 if(sqliteFirst&&!catalogStore)throw Error('SQLITE_FIRST_REQUIRES_CATALOG');
 let ingest=null,catalogError=null;
 if(sqliteFirst){
  // Synchronous, transactional SQLite ingest; reject on failure before JSON write.
  const mirrorId=randomUUID();
  ingest=catalogStore.ingestOffers(observations,searchedAt,{jsonMirror:{id:mirrorId,snapshot:applied.history},scanSummary:applied.history.lastScan});
  await saveHistory(applied.history);
  if(catalogStore.completeJsonMirror)catalogStore.completeJsonMirror(mirrorId);
 }else{
  await saveHistory(applied.history);
  if(catalogStore){
   try{ingest=catalogStore.ingestOffers(observations,searchedAt,{scanSummary:applied.history.lastScan})}
   catch(error){catalogError=/^[A-Z0-9_]+$/.test(error?.message)?error.message:'CATALOG_INTEGRATION_ERROR';}
  }
 }
 return{applied,ids,ingest,catalogError};
}
