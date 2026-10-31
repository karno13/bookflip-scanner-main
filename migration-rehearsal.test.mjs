import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProductionCatalog} from './catalog-production.mjs';
import {emptyOfferHistory,applyScanToHistory} from './offer-history.mjs';
import {rehearseHistoryMigration} from './migration-rehearsal.mjs';

test('rehearsal imports legacy history into a copy without touching original stores',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'bookflip-rehearsal-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const originalDb=join(dir,'catalog.sqlite'),originalJson=join(dir,'history.json'),out=join(dir,'copy');
 const catalog=createProductionCatalog({databasePath:originalDb});
 catalog.close();
 const offer={source:'Vinted',url:'https://www.vinted.pl/items/42-book',title:'Książka',price:1550};
 const old=applyScanToHistory(emptyOfferHistory(),[offer],'2026-10-30T12:00:00.000Z').history;
 writeFileSync(originalJson,JSON.stringify(old));
 const originalJsonContent=readFileSync(originalJson,'utf8');
 const first=await rehearseHistoryMigration({jsonPath:originalJson,sqlitePath:originalDb,outputDirectory:out});
 assert.equal(first.format,'bookflip-migration-rehearsal-v1');
 assert.equal(first.before.summary.missingInSqlite,1);
 assert.equal(first.after.summary.missingInSqlite,0);
 assert.equal(first.after.summary.pricePointsMissing,0);
 assert.equal(first.blockingDifferences,false);
 assert.equal(existsSync(first.reportPath),true);
 assert.equal(readFileSync(originalJson,'utf8'),originalJsonContent);
 const original=createProductionCatalog({databasePath:originalDb});
 try{assert.equal(original.repository.counts().offers,0);}finally{original.close();}
 const snapshot=createProductionCatalog({databasePath:first.snapshot.sqlitePath});
 try{assert.equal(snapshot.repository.counts().offers,1);}finally{snapshot.close();}
 await assert.rejects(rehearseHistoryMigration({jsonPath:originalJson,sqlitePath:originalDb,outputDirectory:out}),/MIGRATION_OUTPUT_ALREADY_EXISTS/);
});
test('rehearsal refuses missing sources without creating output directory',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'bookflip-rehearsal-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const output=join(dir,'output');
 await assert.rejects(rehearseHistoryMigration({jsonPath:join(dir,'missing.json'),sqlitePath:join(dir,'missing.sqlite'),outputDirectory:output}),/MIGRATION_JSON_MISSING/);
 assert.equal(existsSync(output),false);
});
