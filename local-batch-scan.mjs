import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {scanMarketplace} from './marketplaces.mjs';
import {localSourceHosts} from './local-scan.mjs';

export const defaultQueries=['Warhammer','Herezja Horusa','Warcraft','Forgotten Realms'];

function stamp(date){return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
function consolidate(report){
 const byUrl=new Map();
 for(const row of report.results){if(row.result!=='read')continue;for(const offer of row.offers){const found=byUrl.get(offer.url);if(found){if(!found.matchedQueries.includes(row.query))found.matchedQueries.push(row.query);continue;}byUrl.set(offer.url,{...offer,source:row.source,matchedQueries:[row.query]});}}
 report.offers=[...byUrl.values()];report.summary.uniqueOffers=report.offers.length;
}
export async function runLocalBatch({queries=defaultQueries,sources=Object.keys(localSourceHosts),outputDirectory='scan-results',scanner=scanMarketplace,now=()=>new Date(),log=console.log}={}){
 const startedAt=now().toISOString(),directory=resolve(outputDirectory),outputPath=join(directory,`marketplace-scan-${stamp(new Date(startedAt))}.json`);
 await mkdir(directory,{recursive:true});
 const report={startedAt,finishedAt:null,summary:{attempted:queries.length*sources.length,read:0,unavailable:0,offers:0},queries,sources,results:[]};
 const save=async()=>writeFile(outputPath,JSON.stringify(report,null,2)+'\n','utf8');
 await save();
 for(const query of queries)for(const source of sources){
  const task={source,host:localSourceHosts[source],mode:'discovery',title:query,category:query,searchQuery:query,page:1,paginationVersion:1};
  const observedAt=now().toISOString();
  try{
   const result=await scanner(task);report.summary.read++;report.summary.offers+=result.offers.length;
   report.results.push({source,query,result:'read',observedAt,offers:result.offers,pagination:result.pagination,coverage:result.coverage});
   log(JSON.stringify({source,query,result:'read',offers:result.offers.length,pagination:result.pagination?.state??null}));
  }catch(error){report.summary.unavailable++;report.results.push({source,query,result:'unavailable',observedAt,diagnostic:{code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'SOURCE_REQUEST_FAILED',status:Number.isInteger(error.status)?error.status:null,blocked:error.blocked===true,retryable:error.retryable===true,retryAfter:error.retryAfter??null}});log(JSON.stringify({source,query,result:'unavailable',code:error.message,status:error.status??null,blocked:error.blocked===true}));}
  consolidate(report);await save();
 }
 report.finishedAt=now().toISOString();consolidate(report);await save();log(JSON.stringify({result:'saved',outputPath,...report.summary}));return{report,outputPath};
}

async function main(){const {report}=await runLocalBatch();if(report.summary.unavailable)process.exitCode=2;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({result:'failed',code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'LOCAL_BATCH_FAILED'}));process.exitCode=1;});
