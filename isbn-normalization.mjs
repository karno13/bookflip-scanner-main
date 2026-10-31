export const cleanISBN=value=>String(value||'')
 .replace(/^(?:ISBN(?:-1[03])?\s*:?\s*)/i,'')
 .replace(/[‐‑‒–—−]/g,'-')
 .replace(/[-\s]/g,'')
 .toUpperCase();

export function isbnValid(value){
 const isbn=cleanISBN(value);
 if(!isbn)return true;
 if(/^97[89]\d{10}$/.test(isbn))return [...isbn].reduce((sum,digit,index)=>sum+Number(digit)*(index%2?3:1),0)%10===0;
 if(/^\d{9}[\dX]$/.test(isbn))return [...isbn].reduce((sum,digit,index)=>sum+(digit==='X'?10:Number(digit))*(10-index),0)%11===0;
 return false;
}

export function isbnKeys(value){
 const isbn=cleanISBN(value);
 if(!isbn||!isbnValid(isbn))return [];
 if(isbn.length===10){
  const stem='978'+isbn.slice(0,9),sum=[...stem].reduce((total,digit,index)=>total+Number(digit)*(index%2?3:1),0);
  return [isbn,stem+(10-sum%10)%10];
 }
 if(isbn.startsWith('978')){
  const stem=isbn.slice(3,12),sum=[...stem].reduce((total,digit,index)=>total+Number(digit)*(10-index),0),check=(11-sum%11)%11;
  return [isbn,stem+(check===10?'X':check)];
 }
 return [isbn];
}

export function normalizeISBN(value){
 const isbn=cleanISBN(value);
 return isbn&&isbnValid(isbn)?isbn:null;
}
