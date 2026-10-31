import {pathToFileURL} from 'node:url';
import {rehearseHistoryMigration} from '../migration-rehearsal.mjs';

function parse(args){
 const result={};
 for(let index=0;index<args.length;index+=2){
  const key=args[index],value=args[index+1];
  if(!['--json','--sqlite','--output'].includes(key)||!value||Object.hasOwn(result,key))throw Error('INVALID_MIGRATION_REHEARSAL_ARGUMENTS');
  result[key]=value;
 }
 if(Object.keys(result).length!==3)throw Error('MIGRATION_REHEARSAL_PATHS_REQUIRED');
 return{jsonPath:result['--json'],sqlitePath:result['--sqlite'],outputDirectory:result['--output']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await rehearseHistoryMigration(parse(process.argv.slice(2)));
  console.log(JSON.stringify({reportPath:result.reportPath,blockingDifferences:result.blockingDifferences,after:result.after.summary},null,2));
  if(result.blockingDifferences)process.exitCode=1;
 }catch(error){console.error(String(error?.message||error));process.exitCode=2;}
}
