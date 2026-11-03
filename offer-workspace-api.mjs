const statuses = new Set(['watching','check','negotiating','bought','rejected']);
export function listOfferWorkspace(repository) {
 return repository.database.prepare(`SELECT w.offer_id AS offerId,w.watched,w.purchase_status AS status,
 w.target_price AS targetPrice,w.note,w.updated_at AS updatedAt,
 o.current_price AS currentPrice,o.currency,o.original_title AS title
 FROM offer_workspace w JOIN offers o ON o.id=w.offer_id ORDER BY w.updated_at DESC`).all()
 .map(row => ({...row,watched:Boolean(row.watched),targetReached:
   Boolean(row.watched) && row.targetPrice !== null && row.currency === 'PLN' &&
   Number.isSafeInteger(row.currentPrice) && row.currentPrice <= Math.round(row.targetPrice * 100)
 }));
}
export function setOfferWorkspace(repository, offerId, input) {
 if(typeof offerId !== 'string' || !offerId || offerId.length > 200)
   throw Object.assign(Error('INVALID_OFFER_ID'),{statusCode:400});
 const offer=repository.database.prepare('SELECT id FROM offers WHERE id=?').get(offerId);
 if(!offer) throw Object.assign(Error('OFFER_NOT_FOUND'),{statusCode:404});
 if(!input || typeof input !== 'object' || Array.isArray(input))
   throw Object.assign(Error('INVALID_OFFER_WORKSPACE'),{statusCode:400});
 const watched=input.watched;
 const status=input.status;
 // API targetPrice is user-entered PLN; offer current_price is stored in grosze.
 const target=input.targetPrice;
 const note=input.note;
 if(typeof watched !== 'boolean' || !statuses.has(status) ||
    (target !== null && (!Number.isFinite(target) || target < 0 || target > 100000000 || Math.round(target * 100) !== target * 100)) ||
    typeof note !== 'string' || note.length > 2000)
    throw Object.assign(Error('INVALID_OFFER_WORKSPACE'),{statusCode:400});
 const now=new Date().toISOString();
 repository.database.prepare(`INSERT INTO offer_workspace(offer_id,watched,purchase_status,target_price,note,updated_at)
 VALUES(?,?,?,?,?,?) ON CONFLICT(offer_id) DO UPDATE SET watched=excluded.watched,
 purchase_status=excluded.purchase_status,target_price=excluded.target_price,
 note=excluded.note,updated_at=excluded.updated_at`)
 .run(offerId,watched?1:0,status,target,note,now);
 return {offerId,watched,status,targetPrice:target,note,updatedAt:now};
}
