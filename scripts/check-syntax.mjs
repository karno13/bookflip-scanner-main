import {readdirSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(new URL('..',import.meta.url).pathname);
const ignored=new Set(['.git','node_modules','scan-results','coverage']);
function* sources(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(entry.isDirectory()){
   if(!ignored.has(entry.name))yield* sources(join(dir,entry.name));
  }else if(entry.isFile()&&/\\.(?:mjs|js)$/.test(entry.name)){
   yield join(dir,entry.name);
  }
 }
}
const files=[...sources(root)],failed=[];
for(const file of files){
 const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});
 if(result.status!==0){
  failed.push(relative(root,file));
  process.stderr.write(result.stderr||result.stdout||'Syntax check failed\\n');
 }
}
if(failed.length){
 console.error('Syntax errors in:',failed.join(', '));
 process.exitCode=1;
}else{
 console.log('Syntax OK:',files.length,'JavaScript modules');
}
