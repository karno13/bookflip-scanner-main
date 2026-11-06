import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { backupCatalog } from './scripts/backup-catalog.mjs';

function fail(code, statusCode = 400) { throw Object.assign(Error(code), { statusCode }); }
export function amount(value) {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100000000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) fail('INVALID_AMOUNT');
  return Math.round(value * 100) / 100;
}
export function getTradingDefaults(repo) {
  const row = repo.database.prepare("SELECT value_json FROM app_preferences WHERE key='trading_defaults'").get();
  return row ? JSON.parse(row.value_json) : { shipping: null, other: null };
}
export function saveTradingDefaults(repo, input) {
  const value = { shipping: amount(input?.shipping), other: amount(input?.other) };
  repo.database.prepare("INSERT INTO app_preferences VALUES('trading_defaults',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(JSON.stringify(value), new Date().toISOString());
  return value;
}
export function getOfferScenario(repo, id) {
  if (!repo.database.prepare('SELECT id FROM offers WHERE id=?').get(id)) fail('OFFER_NOT_FOUND', 404);
  const row = repo.database.prepare('SELECT purchase,shipping,other,resale,actual_purchase AS actualPurchase,updated_at AS updatedAt FROM offer_scenarios WHERE offer_id=?').get(id);
  return row || { purchase: null, shipping: null, other: null, resale: null, actualPurchase: null, updatedAt: null };
}
export function saveOfferScenario(repo, id, input) {
  getOfferScenario(repo, id);
  const values = ['purchase','shipping','other','resale','actualPurchase'].map(key => amount(input?.[key] ?? null));
  repo.database.prepare(`INSERT INTO offer_scenarios(offer_id,purchase,shipping,other,resale,actual_purchase,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(offer_id) DO UPDATE SET purchase=excluded.purchase,shipping=excluded.shipping,other=excluded.other,resale=excluded.resale,actual_purchase=excluded.actual_purchase,updated_at=excluded.updated_at`).run(id,...values,new Date().toISOString());
  return getOfferScenario(repo,id);
}
export function listScanRuns(repo) {
  return repo.database.prepare('SELECT s.scanned_at,s.summary_json,EXISTS(SELECT 1 FROM scan_offer_results r WHERE r.scanned_at=s.scanned_at) AS indexed FROM scan_runs s ORDER BY s.scanned_at DESC LIMIT 50').all().map(row => {
    const summary=JSON.parse(row.summary_json);
    return {at:row.scanned_at,...summary,indexed:Boolean(row.indexed||summary.context)};
  });
}
export function recentReviewDecisions(repo) {
  return repo.database.prepare(`SELECT d.id,d.action,d.reason,d.created_at AS createdAt,d.offer_id AS offerId,o.original_title AS title,
    d.edition_id AS editionId,r.id AS revisionId FROM review_decisions d JOIN offers o ON o.id=d.offer_id
    LEFT JOIN review_revisions r ON r.decision_id=d.id ORDER BY d.created_at DESC,d.id DESC LIMIT 30`).all();
}
export function reopenReviewDecision(repo,id) {
  return repo.transaction(() => {
    const db=repo.database;
    const decision=db.prepare('SELECT * FROM review_decisions WHERE id=?').get(id);
    if (!decision) fail('DECISION_NOT_FOUND',404);
    if (db.prepare('SELECT id FROM review_revisions WHERE decision_id=?').get(id)) fail('DECISION_ALREADY_REOPENED',409);
    const latest=db.prepare('SELECT id FROM review_decisions WHERE offer_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(decision.offer_id);
    if (latest?.id!==id) fail('NEWER_DECISION_EXISTS',409);
    const job=db.prepare('SELECT * FROM identification_jobs WHERE id=?').get(decision.job_id);
    if (!job || job.status==='running') fail('IDENTIFICATION_IN_PROGRESS',409);
    if (db.prepare('SELECT offer_id FROM offer_sets WHERE offer_id=?').get(decision.offer_id)) fail('OFFER_IS_SET',409);
    const active=db.prepare("SELECT * FROM offer_matches WHERE offer_id=? AND status='active'").get(decision.offer_id);
    if (active && active.edition_id!==decision.edition_id) fail('NEWER_ASSIGNMENT_EXISTS',409);
    const now=new Date().toISOString();
    if (active) db.prepare("UPDATE offer_matches SET status='superseded',valid_to=? WHERE id=?").run(now,active.id);
    db.prepare('INSERT INTO review_revisions VALUES(?,?,?)').run(randomUUID(),id,now);
    db.prepare("UPDATE identification_jobs SET status='review_required',result_json=?,lease_token=NULL,lease_expires_at=NULL,run_after=NULL,updated_at=? WHERE id=?").run(JSON.stringify({reason:['operator_correction']}),now,job.id);
    return { jobId:job.id,offerId:decision.offer_id };
  });
}
function text(value, limit, required=false) {
  if (typeof value!=='string' || value.length>limit || (required&&!value.trim())) fail('INVALID_CATALOG_FIELDS');
  return value.trim();
}
export function editCatalogWork(repo,id,input) {
  const title=text(input?.title,500,true);
  if (!Array.isArray(input?.authors) || input.authors.length>30) fail('INVALID_CATALOG_FIELDS');
  const authors=input.authors.map(value=>text(value,200,true));
  const result=repo.database.prepare('UPDATE works SET title=?,authors_json=?,normalized_title=?,verification_status=\'manual\',updated_at=? WHERE id=?').run(title,JSON.stringify(authors),title.normalize('NFC').toLocaleLowerCase('pl'),new Date().toISOString(),id);
  if (!result.changes) fail('WORK_NOT_FOUND',404);
  return {id,title,authors};
}
export function editCatalogEdition(repo,id,input) {
  const title=text(input?.title,500,true), publisher=text(input?.publisher??'',300), language=text(input?.language??'',60), binding=text(input?.binding??'',100);
  const year=input?.publicationYear;
  if (year!==null && (!Number.isSafeInteger(year)||year<1400||year>2100)) fail('INVALID_CATALOG_FIELDS');
  const result=repo.database.prepare("UPDATE editions SET title=?,publisher=?,language=?,binding=?,publication_year=?,verification_status='manual',updated_at=? WHERE id=?").run(title,publisher||null,language||null,binding||null,year,new Date().toISOString(),id);
  if (!result.changes) fail('EDITION_NOT_FOUND',404);
  return {id,title,publisher,language,binding,publicationYear:year};
}
export function mergeCatalogWorks(repo,sourceId,targetId,confirm=false) {
  if (sourceId===targetId) fail('SAME_WORK');
  const db=repo.database;
  const source=db.prepare('SELECT * FROM works WHERE id=?').get(sourceId),target=db.prepare('SELECT * FROM works WHERE id=?').get(targetId);
  if (!source||!target) fail('WORK_NOT_FOUND',404);
  if (db.prepare('SELECT 1 FROM catalog_work_merges WHERE source_id IN (?,?) OR target_id=?').get(sourceId,targetId,sourceId)) fail('WORK_ALREADY_MERGED',409);
  // Preserve old compatibility IDs rather than silently moving their identity.
  if (source.legacy_id && db.prepare('SELECT 1 FROM editions WHERE work_id=? AND legacy_id IS NULL').get(sourceId)) fail('LEGACY_IDENTITY_PROTECTED',409);
  const editions=db.prepare('SELECT id,title FROM editions WHERE work_id=?').all(sourceId);
  const summary={sourceId,targetId,sourceTitle:source.title,targetTitle:target.title,editions:editions.length};
  if (!confirm) return summary;
  return repo.transaction(()=>{
    const oldSeries=db.prepare('SELECT * FROM work_series_annotations WHERE work_id=?').get(sourceId);
    const newSeries=db.prepare('SELECT * FROM work_series_annotations WHERE work_id=?').get(targetId);
    if(oldSeries&&newSeries&&(oldSeries.series!==newSeries.series||oldSeries.volume!==newSeries.volume)) fail('SERIES_CONFLICT',409);
    if(oldSeries&&!newSeries) db.prepare('INSERT INTO work_series_annotations VALUES(?,?,?,?)').run(targetId,oldSeries.series,oldSeries.volume,new Date().toISOString());
    db.prepare('DELETE FROM work_series_annotations WHERE work_id=?').run(sourceId);
    db.prepare('UPDATE editions SET work_id=?,updated_at=? WHERE work_id=?').run(targetId,new Date().toISOString(),sourceId);
    db.prepare('UPDATE external_records SET work_id=? WHERE work_id=?').run(targetId,sourceId);
    // Keep historical external links and decisions intact. The alias resolves old links.
    db.prepare('INSERT INTO catalog_work_merges VALUES(?,?,?)').run(sourceId,targetId,new Date().toISOString());
    return {...summary,merged:true};
  });
}
export async function dataOverview(repo) {
  if(repo.path===':memory:') return { databasePath:':memory:',backups:[],lastBackupAt:null };
  const folder=join(dirname(repo.path),'backups');
  const files=await readdir(folder).catch(error=>{if(error.code==='ENOENT') return []; throw error;});
  const backups=(await Promise.all(files.filter(name=>name.endsWith('.sqlite')).map(async name=>({name,at:(await stat(join(folder,name))).mtime.toISOString()})))).sort((a,b)=>b.at.localeCompare(a.at));
  return { databasePath:repo.path,backupDirectory:folder,lastBackupAt:backups[0]?.at||null,backups:backups.slice(0,20) };
}
export async function tradingRoute({repo,method,path,input}) {
  if(path==='/api/trading-summary'&&method==='GET') {
    const summary=repo.database.prepare(`SELECT count(*) AS watched,
      COALESCE(sum(CASE WHEN w.target_price IS NOT NULL AND o.currency='PLN' AND o.current_price<=round(w.target_price*100) THEN 1 ELSE 0 END),0) AS atTarget
      FROM offer_workspace w JOIN offers o ON o.id=w.offer_id WHERE w.watched=1`).get();
    return {...summary,review:repo.database.prepare("SELECT count(*) AS n FROM identification_jobs WHERE status='review_required'").get().n};
  }
  const setDetails=path.match(/^\/api\/set-details\/([^/]+)$/);
  if(setDetails&&method==='PUT') {
    const id=decodeURIComponent(setDetails[1]);
    if(typeof input?.confirmed!=='boolean') fail('INVALID_SET_DETAILS');
    if(input.confirmed&&repo.database.prepare('SELECT 1 FROM offer_set_unknown_items WHERE offer_id=?').get(id)) fail('SET_HAS_UNKNOWN_ITEMS',409);
    if(input.confirmed&&!repo.database.prepare('SELECT 1 FROM offer_set_editions WHERE offer_id=?').get(id)) fail('SET_HAS_NO_MEMBERS',409);
    const result=repo.database.prepare('UPDATE offer_sets SET composition_confirmed=?,updated_at=? WHERE offer_id=?').run(Number(input.confirmed),new Date().toISOString(),id);
    if(!result.changes) fail('SET_NOT_FOUND',404);
    return {confirmed:input.confirmed};
  }
  const setItem=path.match(/^\/api\/set-items\/([^/]+)\/([^/]+)$/);
  if(setItem&&method==='PUT') return repo.transaction(()=>{
    const offerId=decodeURIComponent(setItem[1]),editionId=decodeURIComponent(setItem[2]);
    if(!Number.isSafeInteger(input?.quantity)||input.quantity<1||input.quantity>10000) fail('INVALID_QUANTITY');
    const result=repo.database.prepare('UPDATE offer_set_editions SET quantity=?,resale_price=? WHERE offer_id=? AND edition_id=?').run(input.quantity,amount(input.resalePrice),offerId,editionId);
    if(!result.changes) fail('SET_MEMBER_NOT_FOUND',404);
    repo.database.prepare('UPDATE offer_sets SET composition_confirmed=0,updated_at=? WHERE offer_id=?').run(new Date().toISOString(),offerId);
    return {saved:true};
  });
  const unknown=path.match(/^\/api\/set-unknown\/([^/]+)(?:\/([^/]+))?$/);
  if(unknown&&['POST','DELETE'].includes(method)) return repo.transaction(()=>{
    const offerId=decodeURIComponent(unknown[1]);
    if(!repo.database.prepare('SELECT offer_id FROM offer_sets WHERE offer_id=?').get(offerId)) fail('SET_NOT_FOUND',404);
    if(method==='POST') {
      const title=text(input?.title,300,true),quantity=input?.quantity;
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000) fail('INVALID_QUANTITY');
      repo.database.prepare('INSERT INTO offer_set_unknown_items VALUES(?,?,?,?)').run(randomUUID(),offerId,title,quantity);
    } else {
      if(!unknown[2]) fail('UNKNOWN_ITEM_REQUIRED');
      repo.database.prepare('DELETE FROM offer_set_unknown_items WHERE offer_id=? AND id=?').run(offerId,decodeURIComponent(unknown[2]));
    }
    repo.database.prepare('UPDATE offer_sets SET composition_confirmed=0,updated_at=? WHERE offer_id=?').run(new Date().toISOString(),offerId);
    return {saved:true};
  });
  if(path==='/api/trading-defaults'&&method==='GET') return getTradingDefaults(repo);
  if(path==='/api/trading-defaults'&&method==='PUT') return saveTradingDefaults(repo,input);
  if(path==='/api/scan-runs'&&method==='GET') return {items:listScanRuns(repo)};
  if(path==='/api/source-health'&&method==='GET') return {items:repo.database.prepare('SELECT * FROM source_health ORDER BY source').all()};
  if(path==='/api/review-decisions'&&method==='GET') return {items:recentReviewDecisions(repo)};
  const reopen=path.match(/^\/api\/review-decisions\/([^/]+)\/reopen$/);
  if(reopen&&method==='POST') return reopenReviewDecision(repo,decodeURIComponent(reopen[1]));
  const scenario=path.match(/^\/api\/offer-scenarios\/([^/]+)$/);
  if(scenario&&method==='GET') return getOfferScenario(repo,decodeURIComponent(scenario[1]));
  if(scenario&&method==='PUT') return saveOfferScenario(repo,decodeURIComponent(scenario[1]),input);
  const work=path.match(/^\/api\/catalog\/works\/([^/]+)$/);
  if(work&&method==='PUT') return editCatalogWork(repo,decodeURIComponent(work[1]),input);
  const edition=path.match(/^\/api\/catalog\/editions\/([^/]+)$/);
  if(edition&&method==='PUT') return editCatalogEdition(repo,decodeURIComponent(edition[1]),input);
  if(path==='/api/catalog/merge-works'&&method==='POST') return mergeCatalogWorks(repo,input?.sourceId,input?.targetId,input?.confirm===true);
  if(path==='/api/data/overview'&&method==='GET') return dataOverview(repo);
  if(path==='/api/data/backup'&&method==='POST') {
    if(repo.path===':memory:') fail('BACKUP_REQUIRES_FILE',409);
    const destination=join(dirname(repo.path),'backups','bookflip-manual-'+Date.now()+'-'+randomUUID()+'.sqlite');
    return {path:await backupCatalog({source:repo.path,destination}),...await dataOverview(repo)};
  }
  return undefined;
}
