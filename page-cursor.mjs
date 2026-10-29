// Freeze only page URLs, never availability or prices. Missing URLs are counted as skipped.
export function preparePage(task,offers,pagination){
 const stable=task.pageCursorVersion===2&&Array.isArray(task.pageUrls);
 const urls=stable?task.pageUrls:[...new Set(offers.map(o=>o.url))];
 const cursor=stable?task.pageCursor:pagination;
 return {repeated:!stable&&(task.pageDigests||[]).includes(pagination.digest),urls,byUrl:new Map(offers.map(o=>[o.url,o])),offset:stable?(task.pageOffset||0):0,pagination:{...pagination,...cursor,cursorVersion:2,total:urls.length,...(!stable?{urls}:{})}};
}
export function pageBatch(page,offset,max=3){
 if(page.repeated)return {offers:[],pagination:{...page.pagination,urls:[],total:0,offset:0,endOffset:0}};
 const offers=[];let endOffset=offset;
 while(endOffset<page.urls.length&&offers.length<max){const row=page.byUrl.get(page.urls[endOffset]);if(row){if(JSON.stringify([...offers,row]).length>65000)break;offers.push(row);}endOffset++;}
 if(endOffset===offset&&endOffset<page.urls.length)throw Error('OFFER_PAYLOAD_TOO_LARGE');
 return {offers,pagination:{...page.pagination,offset,endOffset}};
}
