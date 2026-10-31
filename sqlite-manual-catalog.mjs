import {randomUUID} from 'node:crypto';
import {createCatalogBook,linkOfferToBook,saveOfferHistory} from './offer-history.mjs';
import {normalizeOfferUrl} from './offer-identity.mjs';
import {recoverPendingMirrors} from './scan-mirror-recovery.mjs';

function required(code){throw Object.assign(Error(code),{statusCode:409});}
function editionForBook(repo,bookId){
 return repo.database.prepare('SELECT id FROM editions WHERE legacy_id=?').get(bookId)?.id||null;
}
function offerForLegacy(repo,legacyOffer){
 const db=repo.database;
 const byId=db.prepare('SELECT id FROM offers WHERE id=? OR legacy_id=? LIMIT 1').get(legacyOffer.id,legacyOffer.id);
 if(byId)return byId.id;
 let url;
 try{url=normalizeOfferUrl(legacyOffer.url);}catch{required('SQLITE_OFFER_NOT_FOUND');}
 const matches=db.prepare('SELECT id FROM offers WHERE source=? AND normalized_url=? LIMIT 2').all(legacyOffer.source,url);
 if(matches.length!==1)required(matches.length?'SQLITE_OFFER_AMBIGUOUS':'SQLITE_OFFER_NOT_FOUND');
 return matches[0].id;
}
function ensureBook(repo,book,at){
 let editionId=editionForBook(repo,book.id);
 if(editionId)return editionId;
 if(book.isbn){
  const matched=repo.database.prepare("SELECT edition_id FROM edition_identifiers WHERE normalized_value=? AND scheme IN ('isbn10','isbn13') LIMIT 1").get(book.isbn);
  if(matched)required('SQLITE_ISBN_ALREADY_EXISTS');
 }
 const work=repo.createWork({legacyId:book.id,title:book.title,verificationStatus:'manual',at});
 const edition=repo.createEdition({workId:work.id,legacyId:book.id,title:book.title,verificationStatus:'manual',at});
 if(book.isbn)repo.attachIdentifier(edition.id,book.isbn.length===10?'isbn10':'isbn13',book.isbn,{source:'local_manual',verificationStatus:'manual',at});
 return edition.id;
}

// A single SQLite transaction stores the manual decision and the exact JSON
// mirror checkpoint; the JSON write follows and is durably acknowledged.
export async function persistManualCatalogAction({
 catalogStore,history,action,input,saveHistory=saveOfferHistory,
 recover=true,loadHistory
}){
 if(!catalogStore?.repository)required('SQLITE_MANUAL_REQUIRES_CATALOG');
 if(recover)await recoverPendingMirrors({repository:catalogStore.repository,...(loadHistory?{loadHistory}:{})});
 const at=new Date().toISOString();
 const created=action==='create'?createCatalogBook(history,input,at):null;
 const next=created?.history||(action==='link'?linkOfferToBook(history,String(input.offerId||''),String(input.bookId||''),at):null);
 if(!next)required('INVALID_MANUAL_CATALOG_ACTION');
 const repo=catalogStore.repository,checkpointId=randomUUID();
 repo.transaction(()=>{
  if(action==='create')ensureBook(repo,created.book,at);
  else{
   const original=history.offers[String(input.offerId||'')];
   const sqliteOfferId=offerForLegacy(repo,original);
   const editionId=editionForBook(repo,String(input.bookId||''));
   if(!editionId)required('SQLITE_EDITION_NOT_FOUND');
   const current=repo.database.prepare("SELECT edition_id,method FROM offer_matches WHERE offer_id=? AND status='active' LIMIT 1").get(sqliteOfferId);
   if(current?.edition_id!==editionId||!['manual','legacy_manual'].includes(current.method||'')){
    repo.assignOfferToEdition(sqliteOfferId,editionId,{method:'manual',status:'active',createdBy:'local_user',at});
   }
  }
  repo.database.prepare("INSERT INTO scan_json_mirror_outbox(id,snapshot_json,scanned_at,status,created_at) VALUES(?,?,?,'pending',?)")
   .run(checkpointId,JSON.stringify(next),at,at);
 });
 await saveHistory(next);
 if(catalogStore.completeJsonMirror)catalogStore.completeJsonMirror(checkpointId);
 return{history:next,created:created?.created??false,book:created?.book??null,checkpointId};
}
