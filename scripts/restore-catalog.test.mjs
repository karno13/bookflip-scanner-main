import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { backupCatalog } from './backup-catalog.mjs';
import { restoreCatalog, verifyCatalogBackup } from './restore-catalog.mjs';

test('verified restore creates new database and refuses overwriting existing data', async () => {
 const dir=await mkdtemp(join(tmpdir(),'bookflip-restore-'));
 const original=join(dir,'original.sqlite'), backup=join(dir,'backup.sqlite');
 const destination=join(dir,'restored.sqlite');
 try {
   const repo=new SqliteCatalogRepository(original);
   repo.createWork({title:'Książka odzyskana'});
   repo.close();
   await backupCatalog({source:original,destination:backup});
   assert.equal(verifyCatalogBackup(backup).valid,true);
   assert.equal(await restoreCatalog({source:backup,destination}),destination);
   const restored=new SqliteCatalogRepository(destination);
   assert.equal(restored.database.prepare('SELECT count(*) AS n FROM works').get().n,1);
   restored.close();
   await assert.rejects(restoreCatalog({source:backup,destination}),/RESTORE_DESTINATION_EXISTS/);
   await assert.rejects(restoreCatalog({source:backup,destination:backup}),/RESTORE_SOURCE_EQUALS_DESTINATION/);
   const before=await readFile(original);
   assert.ok(before.length>0);
 } finally {await rm(dir,{recursive:true,force:true});}
});
