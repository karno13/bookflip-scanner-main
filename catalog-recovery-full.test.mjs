import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionCatalog} from './catalog-production.mjs';
import {setOfferWorkspace,listOfferWorkspace} from './offer-workspace-api.mjs';
import {putScanProfile,listScanProfiles} from './scan-profiles-api.mjs';
import {updateWorkSeries,listWorkSeries} from './work-series-api.mjs';
import {persistSqliteScan} from './sqlite-single-store.mjs';
import {backupCatalog} from './scripts/backup-catalog.mjs';
import {restoreCatalog,verifyCatalogBackup} from './scripts/restore-catalog.mjs';

test('full catalog with WAL, price changes, notes, series and profiles survives backup → restore',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bookflip-complete-recovery-'));
  const original=join(dir,'live.sqlite'),backup=join(dir,'backup.sqlite'),restored=join(dir,'recovered.sqlite');
  let live,copy;
  try {
    live=createProductionCatalog({databasePath:original});
    const at='2026-11-01T12:00:00.000Z';
    const work=live.repository.createWork({title:'Warcraft',verificationStatus:'manual',at});
    live.repository.createEdition({workId:work.id,title:'Warcraft I',verificationStatus:'manual',at});
    updateWorkSeries(live.repository,work.id,{series:'Warcraft',volume:1});
    const offer={source:'Vinted',url:'https://www.vinted.pl/items/123456-warcraft',title:'Warcraft I',price:2500};
    persistSqliteScan(live,{offers:[offer],searchedAt:at});
    persistSqliteScan(live,{offers:[{...offer,price:1800}],searchedAt:'2026-11-01T13:00:00.000Z'});
    const offerId=live.repository.database.prepare('SELECT id FROM offers LIMIT 1').get().id;
    setOfferWorkspace(live.repository,offerId,{
      watched:true,status:'check',targetPrice:20.5,note:'Zachowaj polskie znaki: żółw',
    });
    putScanProfile(live.repository,'Warcraft',{queries:['Warcraft'],sources:['Vinted','OLX']});
    // Backup runs while the live WAL-mode SQLite connection is still open.
    assert.equal(await backupCatalog({source:original,destination:backup}),backup);
    assert.equal(verifyCatalogBackup(backup).valid,true);
    assert.equal(await restoreCatalog({source:backup,destination:restored}),restored);
    copy=createProductionCatalog({databasePath:restored});
    const originalDb=live.repository.database,restoredDb=copy.repository.database;
    const tables=['works','editions','offers','offer_price_history','offer_workspace',
      'work_series_annotations','scan_profiles','schema_migrations'];
    for(const table of tables){
      const sql='SELECT count(*) AS total FROM '+table;
      assert.equal(restoredDb.prepare(sql).get().total,originalDb.prepare(sql).get().total,table);
    }
    assert.deepEqual(listOfferWorkspace(copy.repository).map(({updatedAt,...x})=>x),
      listOfferWorkspace(live.repository).map(({updatedAt,...x})=>x));
    assert.deepEqual(listScanProfiles(copy.repository).map(({updatedAt,...x})=>x),
      listScanProfiles(live.repository).map(({updatedAt,...x})=>x));
    assert.deepEqual(listWorkSeries(copy.repository),listWorkSeries(live.repository));
    assert.equal(restoredDb.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(restoredDb.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    await assert.rejects(restoreCatalog({source:backup,destination:restored}),/RESTORE_DESTINATION_EXISTS/);
  }finally{
    copy?.close();
    live?.close();
    await rm(dir,{recursive:true,force:true});
  }
});
