import {isDeepStrictEqual} from 'node:util';
import {loadOfferHistory,saveOfferHistory} from './offer-history.mjs';

// Called under the same local history-write lock as the next scan.
// A newer JSON snapshot is never overwritten; operator intervention is then required.
export async function recoverPendingMirrors({
 repository,loadHistory=loadOfferHistory,saveHistory=saveOfferHistory
}){
 const pending=repository.database.prepare("SELECT id,snapshot_json,scanned_at FROM scan_json_mirror_outbox WHERE status='pending' ORDER BY created_at,id").all();
 let recovered=0;
 for(const row of pending){
  const desired=JSON.parse(row.snapshot_json),current=await loadHistory();
  if(current.updatedAt && String(current.updatedAt)>String(desired.updatedAt||'')){
   repository.database.prepare("UPDATE scan_json_mirror_outbox SET status='conflict' WHERE id=?").run(row.id);
   throw Error('JSON_MIRROR_RECOVERY_CONFLICT');
  }
  // Equal timestamps are not proof of equal content: another manual edit
  // could have been saved in the same millisecond.
  if(current.updatedAt!=null && String(current.updatedAt)===String(desired.updatedAt||'')){
   if(!isDeepStrictEqual(current,desired)){
    repository.database.prepare("UPDATE scan_json_mirror_outbox SET status='conflict' WHERE id=?").run(row.id);
    throw Error('JSON_MIRROR_RECOVERY_CONFLICT');
   }
   // Already written: only the SQLite acknowledgement was interrupted.
  }else{
   await saveHistory(desired);
  }
  repository.database.prepare("UPDATE scan_json_mirror_outbox SET status='completed',completed_at=? WHERE id=?").run(new Date().toISOString(),row.id);
  recovered++;
 }
 const conflicts=repository.database.prepare("SELECT count(*) AS n FROM scan_json_mirror_outbox WHERE status='conflict'").get().n;
 if(conflicts)throw Error('JSON_MIRROR_RECOVERY_CONFLICT');
 return{recovered};
}
