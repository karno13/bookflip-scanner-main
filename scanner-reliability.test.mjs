import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptsBook, retryAfterSeconds} from './marketplaces.mjs';
import {parseVintedDetail, enrichVintedBatch} from './vinted-detail.mjs';

test('empty watchlist query cannot accept arbitrary listings', () => {
 const task={mode:'watchlist',title:'',source:'Vinted'};
 assert.equal(acceptsBook(task,'Unrelated listing'),false);
 assert.equal(acceptsBook({...task,title:'   '},'Warhammer novel'),false);
});
test('watchlist still recognizes normalized book titles', () => {
 const task={mode:'watchlist',title:'Łowca',source:'OLX'};
 assert.equal(acceptsBook(task,'Książka Lowca'),true);
});
test('Retry-After stays within bounded cooldown', () => {
 assert.equal(retryAfterSeconds('0',0),30);
 assert.equal(retryAfterSeconds('120',0),120);
 assert.equal(retryAfterSeconds('999999999',0),86400);
 assert.equal(retryAfterSeconds('invalid',0),30);
});

test('Vinted detail extracts ISBN from matching item JSON-LD with array types', () => {
 const url='https://www.vinted.pl/items/10506576818-a-z-popiolow-zrodzi-sie-ogien-sabaa-tahir';
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':['Product','Book'],url,gtin13:'9788367551809'})+'</script>';
 const parsed=parseVintedDetail(html,url);
 assert.equal(parsed.recognized,true);
 assert.equal(parsed.isbn,'9788367551809');
});
test('Vinted detail does not take ISBN from another item', () => {
 const url='https://www.vinted.pl/items/10506576818-a-z-popiolow-zrodzi-sie-ogien-sabaa-tahir';
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Book',url:'https://www.vinted.pl/items/99999999-another-book',isbn:'9788367551809'})+'</script>';
 const parsed=parseVintedDetail(html,url);
 assert.equal(parsed.recognized,false);
 assert.equal(parsed.isbn,null);
});

test('Vinted reads nested ISBN only for matching item ID in RSC payload', () => {
 const url='https://www.vinted.pl/items/10506576818-a-z-popiolow-zrodzi-sie-ogien-sabaa-tahir';
 const payload=JSON.stringify([1,JSON.stringify({item:{id:10506576818,attributes:[{name:'ISBN',value:'9788367551809'}]},recommended:{item:{id:123456789,isbn:'9788320000000'}}})]);
 const html='<script>self.__next_f.push('+payload+')</script>';
 const parsed=parseVintedDetail(html,url);
 assert.equal(parsed.isbn,'9788367551809');
 assert.equal(parsed.isbnStatus,'found');
});
test('Vinted does not accept ISBN from a different item in RSC', () => {
 const url='https://www.vinted.pl/items/10506576818-test';
 const payload=JSON.stringify([1,JSON.stringify({item:{id:123456789,isbn:'9788367551809'}})]);
 const parsed=parseVintedDetail('<script>self.__next_f.push('+payload+')</script>',url);
 assert.equal(parsed.isbn,null);
 assert.equal(parsed.isbnStatus,'schema_unrecognized');
});
test('Vinted enrich continues after unrecognized detail schema',async()=>{
 const offers=[{url:'https://www.vinted.pl/items/10506576818-test',title:'Książka'}];
 const result=await enrichVintedBatch(offers,{reader:async()=>({recognized:false})});
 assert.equal(result.length,1);
 assert.match(result[0].description,/nie rozpoznano struktury/);
 assert.equal(result[0].isbn,undefined);
});

test('Fulgrim the Perfect Son (7103170521): ISBN from matching Vinted book attributes', () => {
 const url='https://www.vinted.pl/items/7103170521-warhammer-fulgrim-the-perfect-son-jude-reid';
 // Synthetic page fixture based on fields visible in the user-provided Vinted screenshot,
 // NOT a capture of the actual Vinted HTML.
 const payload=JSON.stringify([1,JSON.stringify({
  item:{id:7103170521,title:'Fulgrim - The Perfect Son',attributes:[
   {name:'ISBN',value:'9781804079720'},{name:'Autor',value:'Jude Reid'},
   {name:'Język',value:'Angielski'}
  ]},
  related:{item:{id:9999999,isbn:'9788367551809'}}
 })]);
 const result=parseVintedDetail('<script>self.__next_f.push('+payload+')</script>',url);
 assert.equal(result.recognized,true);
 assert.equal(result.isbnStatus,'found');
 assert.equal(result.isbn,'9781804079720');
});
test('Fulgrim: an ISBN on an unrelated listing cannot be inherited', () => {
 const url='https://www.vinted.pl/items/7103170521-warhammer-fulgrim-the-perfect-son-jude-reid';
 const html='<script type="application/ld+json">'+JSON.stringify({
  '@type':'Book',url:'https://www.vinted.pl/items/9999999-other',
  isbn:'9781804079720'
 })+'</script>';
 const result=parseVintedDetail(html,url);
 assert.equal(result.isbn,null);
 assert.equal(result.isbnStatus,'schema_unrecognized');
});
test('Fulgrim: ISBN survives Vinted enrichment as a standalone offer field',async()=>{
 const offer={url:'https://www.vinted.pl/items/7103170521-warhammer-fulgrim-the-perfect-son-jude-reid',title:'Fulgrim - The Perfect Son'};
 const enriched=await enrichVintedBatch([offer],{reader:async()=>({
  recognized:true,isbn:'9781804079720',
  isbnDetection:{status:'valid',observations:[{value:'9781804079720',source:'attributes.ISBN',valid:true}]}
 })});
 assert.equal(enriched[0].isbn,'9781804079720');
 assert.match(enriched[0].isbnEvidence,/Vinted/);
});


test('Fulgrim: reads the exact ISBN attribute from live-shape Vinted HTML',()=>{
 const url='https://www.vinted.pl/items/7103170521-warhammer-fulgrim-the-perfect-son-jude-reid';
 const html='<link rel="canonical" href="'+url+'"><div data-testid="item-attributes-isbn_nav"><div><span>ISBN</span></div><div><a data-testid="item-attributes-isbn_nav-link">9781804079720</a></div></div><div data-testid="recommendation"><div data-testid="item-attributes-isbn_nav"><div><span>ISBN</span></div><div><a data-testid="item-attributes-isbn_nav-link">9788367551809</a></div></div></div>';
 const result=parseVintedDetail(html,url);
 assert.equal(result.recognized,true);assert.equal(result.isbn,'9781804079720');assert.equal(result.isbnStatus,'found');
});
test('A z popiołów: reads the exact ISBN attribute from Vinted HTML',()=>{
 const url='https://www.vinted.pl/items/10506576818-a-z-popiolow-zrodzi-sie-ogien-sabaa-tahir';
 const html='<link rel="canonical" href="'+url+'"><div data-testid="item-attributes-isbn_nav"><div><span>ISBN</span></div><div><a data-testid="item-attributes-isbn_nav-link">9788367551809</a></div></div>';
 const result=parseVintedDetail(html,url);
 assert.equal(result.recognized,true);assert.equal(result.isbn,'9788367551809');assert.equal(result.isbnStatus,'found');
});
test('Vinted HTML ISBN row is ignored when canonical URL identifies another offer',()=>{
 const url='https://www.vinted.pl/items/7103170521-warhammer-fulgrim-the-perfect-son-jude-reid';
 const html='<link rel="canonical" href="https://www.vinted.pl/items/10506576818-a-z-popiolow"><a data-testid="item-attributes-isbn_nav-link">9788367551809</a>';
 const result=parseVintedDetail(html,url);
 assert.equal(result.recognized,false);assert.equal(result.isbn,null);
});
