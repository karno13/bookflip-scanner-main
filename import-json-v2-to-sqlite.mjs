import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {SqliteCatalogRepository} from './sqlite-catalog-repository.mjs';
import {normalizeISBN} from './isbn-normalization.mjs';
import {normalizeOfferUrl} from './offer-identity.mjs';

function stableId(prefix,value){return `${prefix}_${createHash('sha256').update(String(value)).digest('hex').slice(0,24)}`;}
function titleFor(row,id,conflicts){const title=String(row?.title||row?.originalTitle||'').trim();if(title)return title.slice(0,500);conflicts.push({kind:'missing_title',legacyId:id});return `[bez tytułu: ${id}]`.slice(0,500);}
function externalOfferId(row){const prefix=`${row.source}:`,suffix=String(row.id||'').startsWith(prefix)?String(row.id).slice(prefix.length):'';return suffix&&!/^https?:\/\//i.test(suffix)?suffix:null;}
function validV2(value){return value?.version===2&&value.books&&typeof value.books==='object'&&value.offers&&typeof value.offers==='object'&&Array.isArray(value.priceHistory);}

export function importJsonV2Data(history,repository,{now=()=>new Date(),preserveExistingOffers=false}={}){
 if(!validV2(history))throw Error('INVALID_JSON_V2_HISTORY');
 const before=repository.counts(),conflicts=[],bookEditions=new Map(),importedOffers=new Map(),at=history.updatedAt||now().toISOString();
 const source={books:Object.keys(history.books).length,offers:Object.keys(history.offers).length,priceHistory:history.priceHistory.length};
 let sourceIdentifiers=0,sourceMatches=0,sourceEvidence=0;
 repository.transaction(()=>{
  for(const [legacyId,book] of Object.entries(history.books)){
   const workId=stableId('legacy_work',legacyId),editionId=stableId('legacy_edition',legacyId),title=titleFor(book,legacyId,conflicts),manual=book.origin==='manual',verificationStatus=manual?'manual':'historical_unverified';
   repository.createWork({id:workId,legacyId,title,verificationStatus,at:book.firstSeenAt||at});
   repository.createEdition({id:editionId,workId,legacyId,title,verificationStatus,at:book.firstSeenAt||at});
   bookEditions.set(legacyId,editionId);
   repository.putMetadataEvidence({id:stableId('evidence',`book-title:${legacyId}`),workId,editionId,fieldName:'title',value:title,classification:'legacy',sourceType:'json_v2',verificationStatus,observedAt:book.lastSeenAt||at,at});sourceEvidence++;
   if(book.isbn){const isbn=normalizeISBN(book.isbn);if(isbn){const scheme=isbn.length===10?'isbn10':'isbn13';repository.attachIdentifier(editionId,scheme,isbn,{source:'json_v2',verificationStatus:'historical_unverified',at:book.firstSeenAt||at});sourceIdentifiers++;repository.putMetadataEvidence({id:stableId('evidence',`book-isbn:${legacyId}:${isbn}`),editionId,fieldName:'isbn',value:isbn,classification:'legacy',sourceType:'json_v2',verificationStatus:'historical_unverified',observedAt:book.lastSeenAt||at,at});sourceEvidence++;}else conflicts.push({kind:'invalid_book_isbn',legacyId,value:String(book.isbn)});}
  }

  for(const [legacyId,offer] of Object.entries(history.offers)){
   let url;try{url=normalizeOfferUrl(offer.url);}catch{conflicts.push({kind:'invalid_offer_url',legacyId});continue;}
   const existing=preserveExistingOffers?repository.database.prepare('SELECT * FROM offers WHERE id=? OR (source=? AND normalized_url=?) LIMIT 1').get(legacyId,offer.source,url):null;
   const stored=existing||repository.upsertOffer({id:legacyId,legacyId,source:offer.source,externalOfferId:externalOfferId({...offer,id:legacyId}),normalizedUrl:url,originalTitle:String(offer.originalTitle||'').slice(0,500),currentPrice:offer.currentPrice,currency:'PLN',availability:offer.availability||'unconfirmed',language:offer.language||null,observedIsbn:normalizeISBN(offer.isbn),matchedQueries:offer.matchedQueries||[],firstSeenAt:offer.firstSeenAt,lastSeenAt:offer.lastSeenAt,seenCount:offer.seenCount||0,at});importedOffers.set(legacyId,stored.id);
   const isbn=normalizeISBN(offer.isbn);if(isbn){repository.putMetadataEvidence({id:stableId('evidence',`offer-isbn:${legacyId}:${isbn}`),offerId:stored.id,fieldName:'isbn',value:isbn,classification:'legacy',sourceType:'json_v2',verificationStatus:'historical_unverified',observedAt:offer.lastSeenAt||at,at});sourceEvidence++;}
  }

  for(const point of history.priceHistory){
   const storedOfferId=importedOffers.get(point.offerId);if(!storedOfferId){conflicts.push({kind:'orphan_price',offerId:point.offerId});continue;}
   repository.appendPriceObservation(storedOfferId,point.price,point.observedAt);
  }

  for(const [legacyId,offer] of Object.entries(history.offers)){
   const storedOfferId=importedOffers.get(legacyId);if(!storedOfferId)continue;
   const editionId=bookEditions.get(offer.bookId);
   if(offer.bookId&&!editionId){conflicts.push({kind:'missing_book_for_offer',offerId:legacyId,bookId:offer.bookId});}
   const authoritativeMatch=preserveExistingOffers?repository.database.prepare("SELECT id FROM offer_matches WHERE offer_id=? AND status='active' AND created_by!='json_v2_import' LIMIT 1").get(storedOfferId):null;
   if(editionId&&!authoritativeMatch){
    const manual=offer.linkMode==='manual',status=manual?'active':'review_required',method=manual?'legacy_manual':'legacy_isbn';
    repository.assignOfferToEdition(storedOfferId,editionId,{id:stableId('legacy_match',`${legacyId}:${offer.bookId}:${method}`),method,status,confidence:manual?1:null,reason:manual?'Ręczne przypisanie zachowane z JSON v2.':'Historyczne przypisanie po ISBN; niezweryfikowane przez BN ani Open Library.',createdBy:'json_v2_import',at:offer.lastSeenAt||at});sourceMatches++;
   }
   repository.putIdentificationJob({id:stableId('identification_job',legacyId),offerId:storedOfferId,status:offer.linkMode==='manual'?'completed':editionId?'review_required':'queued',at});
  }
 });
 const after=repository.counts(),inserted=Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]]));
 const expected={works:source.books,editions:source.books,edition_identifiers:sourceIdentifiers,offers:source.offers,offer_price_history:source.priceHistory,offer_matches:sourceMatches,metadata_evidence:sourceEvidence,identification_jobs:source.offers};
 const duplicates=Object.fromEntries(Object.entries(expected).map(([key,count])=>[key,Math.max(0,count-inserted[key])]));
 return{format:'bookflip-json-v2-to-sqlite',source,expected,before,after,inserted,duplicates,conflicts:{count:conflicts.length,items:conflicts},completedAt:now().toISOString()};
}

export function importJsonV2File({sourcePath,databasePath,reportPath=null,snapshotPath=null,busyTimeout=5000}={}){
 if(!sourcePath||!databasePath)throw Error('IMPORT_PATHS_REQUIRED');
 const source=resolve(sourcePath),database=resolve(databasePath),snapshot=resolve(snapshotPath||join(dirname(database),basename(source)+'.snapshot.json')),report=resolve(reportPath||database+'.migration-report.json');
 copyFileSync(source,snapshot);const history=JSON.parse(readFileSync(snapshot,'utf8')),repository=new SqliteCatalogRepository(database,{busyTimeout});
 try{const result={...importJsonV2Data(history,repository),sourcePath:source,snapshotPath:snapshot,databasePath:database,reportPath:report};writeFileSync(report,JSON.stringify(result,null,2)+'\n','utf8');return result;}finally{repository.close();}
}

function cliArguments(args){const result={};for(let index=0;index<args.length;index+=2){const key=args[index]?.replace(/^--/,'');if(!key||!args[index+1])throw Error('INVALID_IMPORT_ARGUMENTS');result[key]=args[index+1];}return result;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const args=cliArguments(process.argv.slice(2)),report=importJsonV2File({sourcePath:args.source,databasePath:args.database,reportPath:args.report,snapshotPath:args.snapshot});console.log(JSON.stringify(report,null,2));}catch(error){console.error(error.message);process.exitCode=1;}}

/** Historical JSON-to-SQLite tool only; not used by the HTTP application. */
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
