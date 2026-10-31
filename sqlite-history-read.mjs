// Read-only compatibility adapter for the legacy /api/history contract.
// This does not alter the catalog or infer bibliographic identity without
// an active edition assignment.
export function sqliteHistoryModel(repository) {
 const db=repository.database;
 const editions=db.prepare(`SELECT e.id,e.legacy_id,e.title,e.created_at,e.updated_at,
   w.legacy_id AS work_legacy_id,w.verification_status
   FROM editions e JOIN works w ON w.id=e.work_id`).all();
 const books={},editionIds=new Map();
 for(const row of editions){
  const bookId=row.legacy_id||row.work_legacy_id||'edition:'+row.id;
  editionIds.set(row.id,bookId);
  if(!books[bookId])books[bookId]={
   id:bookId,title:row.title,isbn:null,origin:row.verification_status==='manual'?'manual':'detected',
   firstSeenAt:row.created_at,lastSeenAt:row.updated_at
  };
 }
 const isbns=db.prepare("SELECT edition_id,normalized_value FROM edition_identifiers WHERE scheme IN ('isbn13','isbn10') ORDER BY CASE scheme WHEN 'isbn13' THEN 0 ELSE 1 END,id").all();
 for(const row of isbns){
  const book=books[editionIds.get(row.edition_id)];
  if(book&&!book.isbn)book.isbn=row.normalized_value;
 }
 const active=db.prepare("SELECT offer_id,edition_id,method FROM offer_matches WHERE status='active' ORDER BY valid_from DESC,created_at DESC,id DESC").all();
 const assignments=new Map();
 for(const row of active)if(!assignments.has(row.offer_id))assignments.set(row.offer_id,row);
 const offers={};
 const rows=db.prepare('SELECT * FROM offers ORDER BY last_seen_at DESC,id').all();
 for(const row of rows){
  const assignment=assignments.get(row.id),bookId=assignment?editionIds.get(assignment.edition_id)||null:null;
  let matchedQueries=[];
  try{matchedQueries=JSON.parse(row.matched_queries_json||'[]');if(!Array.isArray(matchedQueries))matchedQueries=[];}catch{}
  offers[row.id]={
   id:row.id,bookId,linkMode:assignment?(['manual','legacy_manual'].includes(assignment.method)?'manual':'detected'):null,
   originalTitle:row.original_title,currentPrice:row.current_price,source:row.source,url:row.normalized_url,
   firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,availability:row.availability,
   matchedQueries,isbn:row.observed_isbn||null,language:row.language||null,seenCount:row.seen_count
  };
 }
 const priceHistory=db.prepare('SELECT offer_id,price,observed_at FROM offer_price_history ORDER BY observed_at,id').all().map(row=>({
  offerId:row.offer_id,price:row.price,observedAt:row.observed_at
 }));
 const lastScanAt=rows.reduce((max,row)=>String(row.last_seen_at||'')>max?String(row.last_seen_at):max,'');
 const scanRow=db.prepare("SELECT summary_json FROM scan_runs ORDER BY scanned_at DESC LIMIT 1").get();
 let lastScan=null;
 try{lastScan=scanRow?JSON.parse(scanRow.summary_json):null;}catch{}
 return{version:2,updatedAt:lastScanAt||lastScan?.at||null,books,offers,priceHistory,details:{},lastScan};
}
