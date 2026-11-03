import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteCatalogRepository} from './sqlite-catalog-repository.mjs';
import {listScanProfiles,putScanProfile,deleteScanProfile} from './scan-profiles-api.mjs';

test('scan profiles are stored in SQLite and legacy import never overwrites newer profiles', () => {
 const repo=new SqliteCatalogRepository(':memory:');
 const first={queries:['Warcraft'],sources:['Vinted','OLX']};
 const stale={queries:['stale'],sources:['Empik']};
 try {
   assert.deepEqual(putScanProfile(repo,'Fantasy',first),{name:'Fantasy',created:true});
   assert.equal(listScanProfiles(repo).length,1);
   assert.deepEqual(putScanProfile(repo,'Fantasy',stale,{onlyIfAbsent:true}),{name:'Fantasy',created:false});
   assert.deepEqual(listScanProfiles(repo)[0].queries,['Warcraft']);
   assert.deepEqual(putScanProfile(repo,'Fantasy',stale),{name:'Fantasy',created:false});
   assert.deepEqual(listScanProfiles(repo)[0].sources,['Empik']);
   assert.throws(()=>putScanProfile(repo,'bad',{queries:[],sources:['Vinted']}),/INVALID_SCAN_PROFILE/);
   assert.throws(()=>putScanProfile(repo,'bad',{queries:['abc'],sources:['Invalid']}),/INVALID_SCAN_PROFILE/);
   assert.deepEqual(deleteScanProfile(repo,'Fantasy'),{removed:true});
   assert.equal(listScanProfiles(repo).length,0);
 } finally {repo.close();}
});
