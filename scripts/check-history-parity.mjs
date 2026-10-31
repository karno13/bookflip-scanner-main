import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {compareHistoryStores} from '../history-parity.mjs';

const jsonPath=resolve(process.argv[2]||fileURLToPath(new URL('../scan-results/local-offer-history.json',import.meta.url)));
const sqlitePath=resolve(process.argv[3]||fileURLToPath(new URL('../scan-results/bookflip-catalog.sqlite',import.meta.url)));
for(const path of [jsonPath,sqlitePath]){
 if(!existsSync(path)){console.error('HISTORY_STORE_NOT_FOUND: '+path);process.exitCode=2;}
}
if(!process.exitCode){
 let database;
 try{
  const history=JSON.parse(readFileSync(jsonPath,'utf8'));
  database=new DatabaseSync(sqlitePath,{readOnly:true});
  const report=compareHistoryStores(history,database);
  console.log(JSON.stringify(report,null,2));
  if(!report.safeToCutOver)process.exitCode=1;
 }catch(error){console.error('HISTORY_PARITY_ERROR: '+String(error?.message||error));process.exitCode=2;}
 finally{database?.close();}
}
