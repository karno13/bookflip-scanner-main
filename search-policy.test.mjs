import test from 'node:test';import assert from 'node:assert/strict';
import {expandSearchTopics,matchesSearch,matchesTopic,excludesProduct,prioritizeSearchPairs} from './search-policy.mjs';
import {searchUrl} from './marketplaces.mjs';
test('aliases generate actual source queries without granting an edition',()=>{const topics=expandSearchTopics([{title:'Warhammer',mode:'watchlist'},{title:'Horus',mode:'watchlist',searchMode:'bundle'}]);assert.ok(topics.some(t=>t.searchQuery==='WH40K'));assert.ok(topics.some(t=>t.searchQuery==='Horus zestaw'));const task={...topics[1],source:'Vinted',host:'www.vinted.pl'};assert.equal(new URL(searchUrl(task)).searchParams.get('search_text'),task.searchQuery);assert.equal(task.editionId,undefined);assert.ok(matchesSearch({title:'Dzień smoka'},'SMOKA dzień Warcraft'));assert.ok(matchesSearch({title:'Warhammer'},'WH40K książka'));});
test('book with accessory survives; standalone accessories and digital books do not',()=>{assert.equal(excludesProduct('Warhammer książka z zakładką'),false);assert.equal(excludesProduct('Warhammer zakładka'),true);assert.equal(excludesProduct('Warhammer ebook książka'),true);});
test('priority is fair and does not remove unproductive queries',()=>{const pairs=['old','new'].map(searchQuery=>({topic:{searchQuery},source:{name:'Vinted'}}));const result=prioritizeSearchPairs(pairs,[{query:'old',source:'Vinted',updatedAt:new Date().toISOString(),added:0,unchanged:100}]);assert.equal(result[0].topic.searchQuery,'new');assert.equal(result.length,2);});

test('all adapters share a discovery topic policy including Horus and dynamic topics',()=>{
 assert.equal(matchesTopic({mode:'discovery',category:'Warhammer 40K'},'Horus Rising książka'),true);
 assert.equal(matchesTopic({mode:'discovery',category:'Warhammer 40K'},'Buty sportowe'),false);
 assert.equal(matchesTopic({mode:'discovery',category:'Warcraft'},'World of Warcraft książka'),true);
 assert.equal(matchesTopic({mode:'discovery',category:'Forgotten Realms',searchQuery:'Forgotten Realms'},'Forgotten Realms powieść'),true);
 assert.equal(matchesTopic({mode:'discovery',category:'Forgotten Realms',searchQuery:'Forgotten Realms'},'Warhammer książka'),false);
});
