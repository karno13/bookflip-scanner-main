export const cleanISBN=v=>String(v||'').replace(/^(?:ISBN(?:-1[03])?\s*:?\s*)/i,'').replace(/[-\s]/g,'').toUpperCase();
export function isbnValid(v){const s=cleanISBN(v);if(!s)return true;if(/^97[89]\d{10}$/.test(s))return [...s].reduce((n,x,i)=>n+Number(x)*(i%2?3:1),0)%10===0;if(/^\d{9}[\dX]$/.test(s))return [...s].reduce((n,x,i)=>n+(x==='X'?10:Number(x))*(10-i),0)%11===0;return false;}
export function isbnKeys(v){const s=cleanISBN(v);if(!s||!isbnValid(s))return [];if(s.length===10){const stem='978'+s.slice(0,9),sum=[...stem].reduce((n,x,i)=>n+Number(x)*(i%2?3:1),0);return [s,stem+(10-sum%10)%10];}if(s.startsWith('978')){const stem=s.slice(3,12),sum=[...stem].reduce((n,x,i)=>n+Number(x)*(10-i),0),check=(11-sum%11)%11;return [s,stem+(check===10?'X':check)];}return [s];}

// Read evidence, never infer an ISBN from a title or repair guessed digits.
export function extractOfferISBN(o={}){
 const observations=[];
 const add=(value,source)=>{const cleaned=cleanISBN(String(value??'').replace(/[‐‑‒–—−]/g,'-'));if(cleaned)observations.push({value:cleaned,source,valid:isbnValid(cleaned)});};
 for(const field of ['isbn','isbn_10','isbn_13'])if(o[field])add(o[field],field);
 if(Array.isArray(o.isbns))for(const value of o.isbns)add(value,'isbns');
 const ignored=new Set(['matching','isbnDetection','detectedISBN','evaluation','components','history','provenance','manualInputSignature','url','imageUrl','cover_image','price','shipping','protection','other','id','editionId','workId','owner','external_key','isbnEvidence','forecast','prediction','purchaseForecast']);
 let remaining=50000,visited=0,truncated=false;const seen=new Set();
 const walk=(value,path,depth=0,label='')=>{if(value==null||path.split('.').some(k=>k.startsWith('_'))||ignored.has(path.split('.').at(-1)))return;if(depth>5||++visited>1000){truncated=true;return;}if(typeof value==='string'||typeof value==='number'){
 const raw=String(value);if(/^https?:\/\//i.test(raw.trim()))return;const text=raw.slice(0,remaining).replace(/[‐‑‒–—−]/g,'-').replace(/\u00a0/g,' ');remaining-=text.length;if(text.length<raw.length)truncated=true;
 const field=path.split('.').at(-1)||'',named=/^(?:isbn(?:[_ -]?(?:10|13|s))?|ean(?:[_ -]?13)?|gtin(?:[_ -]?13)?|isbn\s*\/\s*ean|ean\s*\/\s*isbn)$/i.test(field)||/\b(?:ISBN|EAN|GTIN)(?:[-_ ]?1[03])?\b/i.test(label);
 if(named&&/^(?:ISBN(?:-1[03])?\s*:?\s*)?[0-9Xx -]+$/.test(text.trim()))add(text,path);
 else for(const match of text.matchAll(/\bISBN(?:-1[03])?\s*:?\s*((?:[0-9Xx][ -]*){9,12}[0-9Xx])(?![ -]*\d)|\b(97[89](?:[ -]?\d){10})(?!\d)/gi))add(match[1]||match[2],path);
 }else if(typeof value==='object'&&!seen.has(value)){seen.add(value);const context=String(value.name||value.label||value.key||'');for(const [key,child] of Object.entries(value)){if(depth===0&&['isbn','isbn_10','isbn_13','isbns'].includes(key))continue;walk(child,path?path+'.'+key:key,depth+1,context);}}};
 walk(o,'');
 const distinct=new Map(observations.map(p=>{const keys=isbnKeys(p.value);return [keys.find(k=>k.length===13)||p.value,p];}));
 const values=[...distinct.keys()],invalid=observations.some(p=>!p.valid);
 const status=values.length>1?'multiple':invalid?'invalid':(o.isbnReadUncertain||truncated)&&values.length?'uncertain':values.length?'valid':'missing';
 return {status,isbn:status==='valid'?values[0]:null,observations,values};
}

// Optional evidence carried by an existing collector or AI reader; never grants verification.
export function bibliographicMetadata(row={}){
 const result={};const limits={isbn:100,isbn_10:100,isbn_13:100,author:500,publisher:500,language:100,binding:100,variant:200,series:300,volume:100,description:10000,ocrText:5000,isbnEvidence:100};
 for(const [field,limit] of Object.entries(limits))if(row[field]!=null){if(typeof row[field]!=='string'||row[field].length>limit)throw Error('Nieprawidłowe pole bibliograficzne: '+field);result[field]=row[field].trim();}
 for(const field of ['isbns','authors'])if(row[field]!=null){
  if(!Array.isArray(row[field])||row[field].length>20||row[field].some(v=>typeof v!=='string'||v.length>(field==='isbns'?100:500)))throw Error('Nieprawidłowe pole bibliograficzne: '+field);
  result[field]=row[field].map(v=>v.trim());
 }
 if(row.parameters!=null){if(typeof row.parameters!=='object'||JSON.stringify(row.parameters).length>20000)throw Error('Nieprawidłowe parametry oferty.');result.parameters=JSON.parse(JSON.stringify(row.parameters));}
 if(row.year!=null){if(!Number.isInteger(row.year)||row.year<1400||row.year>2100)throw Error('Nieprawidłowy rok wydania.');result.year=row.year;}
 if(row.isbnReadUncertain!=null){if(typeof row.isbnReadUncertain!=='boolean')throw Error('Nieprawidłowy status odczytu ISBN.');result.isbnReadUncertain=row.isbnReadUncertain;}
 return result;
}
