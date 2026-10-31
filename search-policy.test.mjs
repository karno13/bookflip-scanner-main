import test from 'node:test';import assert from 'node:assert/strict';
import {expandSearchTopics,matchesSearch,matchesTopic,excludesProduct,bookProductSignals,prioritizeSearchPairs,queryText} from './search-policy.mjs';
import {searchUrl} from './marketplaces.mjs';
test('aliases generate actual source queries without granting an edition',()=>{const topics=expandSearchTopics([{title:'Warhammer',mode:'watchlist'},{title:'Horus',mode:'watchlist',searchMode:'bundle'}]);assert.ok(topics.some(t=>t.searchQuery==='WH40K'));assert.ok(topics.some(t=>t.searchQuery==='Horus zestaw'));const task={...topics[1],source:'Vinted',host:'www.vinted.pl'};assert.equal(new URL(searchUrl(task)).searchParams.get('search_text'),task.searchQuery);assert.equal(task.editionId,undefined);assert.ok(matchesSearch({title:'Dzień smoka'},'SMOKA dzień Warcraft'));assert.ok(matchesSearch({title:'Warhammer'},'WH40K książka'));});
test('book with accessory survives; standalone accessories and digital books do not',()=>{assert.equal(excludesProduct('Warhammer książka z zakładką'),false);assert.equal(excludesProduct('Warhammer zakładka'),true);assert.equal(excludesProduct('Warhammer ebook książka'),true);});
test('live marketplace false positives are rejected as non-books',()=>{
 for(const title of ['Bolter Inquisition mod. cosplay Warhammer 40k','Casio Royale WORLD OF WARCRAFT HORDE MOD','World of Warcraft 60 dni czasu gry','Magic the Gathering Adventures in the Forgotten Realms Booster','GeForce RTX 5070 World of Warcraft'])assert.equal(excludesProduct(title),true,title);
 assert.equal(excludesProduct('World of Warcraft Narodziny Hordy Książka Christie Golden'),false);
});
test('priority is fair and does not remove unproductive queries',()=>{const pairs=['old','new'].map(searchQuery=>({topic:{searchQuery},source:{name:'Vinted'}}));const result=prioritizeSearchPairs(pairs,[{query:'old',source:'Vinted',updatedAt:new Date().toISOString(),added:0,unchanged:100}]);assert.equal(result[0].topic.searchQuery,'new');assert.equal(result.length,2);});

test('all adapters share a discovery topic policy including Horus and dynamic topics',()=>{
 assert.equal(matchesTopic({mode:'discovery',category:'Warhammer 40K'},'Horus Rising książka'),true);
 assert.equal(matchesTopic({mode:'discovery',category:'Warhammer 40K'},'Buty sportowe'),false);
 assert.equal(matchesTopic({mode:'discovery',category:'Warcraft'},'World of Warcraft książka'),true);
 assert.equal(matchesTopic({mode:'discovery',category:'Forgotten Realms',searchQuery:'Forgotten Realms'},'Forgotten Realms powieść'),true);
 assert.equal(matchesTopic({mode:'discovery',category:'Forgotten Realms',searchQuery:'Forgotten Realms'},'Warhammer książka'),false);
});

test('ambiguous words are not enough to reject real book titles',()=>{
 for(const title of ['Gra o tron','Gra Endera','The Watch','Golden Army','Model życia','Gold'])assert.equal(excludesProduct(title),false,title);
 for(const title of ['Gra planszowa Warhammer','Figurka World of Warcraft','Warhammer booster MTG','Model do sklejania'])assert.equal(excludesProduct(title),true,title);
});
test('general-purpose query has no implicit Warhammer or Warcraft fallback',()=>{
 assert.equal(queryText({mode:'discovery',category:'Science fiction'}),'Science fiction');
 assert.equal(queryText({mode:'discovery',title:'Diuna'}),'Diuna');
 assert.equal(queryText({mode:'discovery'}),'');
});

test('backpacks and card games are excluded across all title-based marketplace adapters',()=>{
 for(const title of [
  'Plecak Warcraft','Gra karciana Warcraft','World of Warcraft backpack',
  'Warhammer gra planszowa','Gra karciana World of Warcraft książka'
 ]){
  assert.equal(excludesProduct(title),true,title);
  assert.equal(bookProductSignals(title).excluded,true,title);
 }
});
test('book evidence raises score without rejecting ambiguous real titles',()=>{
 const plausible=['Gra o tron','Gra Endera','Model życia','The Watch','Warcraft powieść','Warhammer książka z zakładką'];
 for(const title of plausible)assert.equal(excludesProduct(title),false,title);
 const ambiguous=bookProductSignals('Gra Endera');
 const isbn=bookProductSignals('Gra Endera',{isbn:'9780306406157'});
 assert.ok(isbn.score>ambiguous.score);
 assert.equal(excludesProduct('Warcraft'),false,'unknown candidate should remain eligible for metadata enrichment');
 assert.equal(excludesProduct('Warcraft Plecak',{isbn:'9780306406157'}),true,'ISBN must not override a physical nonbook format');
});
