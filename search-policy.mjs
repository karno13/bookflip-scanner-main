// Retrieval aliases never confer edition identity or bibliographic verification.
export const normalizeSearch=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ł/g,'l').replace(/[^a-z0-9]+/g,' ').trim();
const families=[['Warhammer','Warhammer 40,000','WH40K','Warhammer 40K'],['Herezja Horusa','Horus Heresy'],['Warcraft','World of Warcraft'],['Forgotten Realms','Zapomniane Krainy']];
export function searchAliases(title){const key=normalizeSearch(title);return families.find(g=>g.some(t=>normalizeSearch(t)===key))?.filter(t=>normalizeSearch(t)!==key)||[];}
export function queryText(task){return String(task.searchQuery|| (task.mode==='watchlist'?task.title:task.category==='Warcraft'?'Warcraft':'Warhammer')).trim();}
export function matchesSearch(task,title){
 const text=normalizeSearch(title),terms=[task.title,task.searchQuery,...(task.aliases||[]),...searchAliases(task.title)].filter(Boolean);
 const match=terms.some(term=>{const tokens=normalizeSearch(term).split(' ').filter(Boolean);return tokens.length&&tokens.every(t=>(' '+text+' ').includes(' '+t+' '));});
 return match;
}
// One matching policy for HTML marketplaces, Atom and authorized JSON feeds.
export function matchesTopic(task,title){
 if(task.mode==='watchlist')return matchesSearch(task,title);
 const category=normalizeSearch(task.category);
 const categoryTerms=category.includes('warcraft')?['Warcraft','World of Warcraft']
  :category.includes('warhammer')||category.includes('horus')||category.includes('herezja')?
   ['Warhammer','Warhammer 40,000','WH40K','Warhammer 40K','Horus','Horus Heresy','Herezja Horusa']
  :[];
 const terms=[task.searchQuery,task.title,...(task.aliases||[]),...categoryTerms];
 if(!terms.some(Boolean))terms.push(task.category||'Warhammer');
 return matchesSearch({title:'',searchQuery:'',aliases:terms},title);
}
export function excludesProduct(title){
 const n=normalizeSearch(title);
 if(/\b(ebook|e book|epub|mobi|audiobook|audio book|stl|gra pc|gra ps5|gra ps4|gra komputerowa)\b/.test(n))return true;
 const book=/\b(ksiazka|ksiazki|ksiazek|book|books|powiesc|novel|tom|tomy|omnibus|codex|kodeks|podrecznik)\b/.test(n);
 return !book&&/\b(figurka|figurki|figurek|statuetka|miniatures?|miniatura|model|modele|unpainted|sprue|wypraski|ramki|bits|dvd|cd|karty|karta|deck|booster|foil|mtg|magic the gathering|naklejki|zakladka|bookmark|cosplay|bolter|pistol|dice|kosci|kostki|armia|army|pojazd|piechota|terminators?|custodian|jetbike|farba|paint|colour|teren|tereny|sceneria|plansza|puzzle|gra|game|pc|ps2|ps3|ps4|ps5|xbox|gold|czasu gry|konto|funko|casio|zegarek|watch|gpu|geforce|rtx|neverwinter nights|demon stone|adventures in the forgotten realms)\b/.test(n);
}
export function expandSearchTopics(topics){
 const seen=new Set(),out=[];
 for(const t of topics){const variants=[t.title,...(t.aliases||[]),...(t.includeAliases===false?[]:searchAliases(t.title))];if(t.searchMode==='bundle')variants.push(t.title+' zestaw',t.title+' pakiet');if(t.searchMode==='edition'&&t.isbn)variants.push(t.isbn);
 for(const searchQuery of variants){const key=normalizeSearch(searchQuery);if(!key||seen.has(key))continue;seen.add(key);out.push({...t,searchQuery});}}
 return out;
}
// Every query remains in the round; productivity changes order, never deletes work.
export function prioritizeSearchPairs(pairs,history,now=Date.now()){
 const rank=p=>{const rows=history.filter(t=>t.source===p.source.name&&(t.searchQuery||t.query)===p.topic.searchQuery);const last=rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];if(!last)return 1000;const age=Math.max(0,(now-Date.parse(last.updatedAt))/3600000);return Math.min(age,168)*10+((last.added||0)/Math.max(1,(last.added||0)+(last.updated||0)+(last.unchanged||0)))*20+(p.topic.priority||0);};
 return pairs.map((p,i)=>({p,i,score:rank(p)})).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.p);
}
