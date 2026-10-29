import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceChallenge,scanMarketplace,parseMarketplace} from './marketplaces.mjs';
const task=source=>({source,host:source==='Tezeusz.pl'?'tezeusz.pl':'dedalus.pl',mode:'watchlist',title:'Warhammer'});
test('form recaptcha scripts do not block readable results; real challenges still block',async()=>{
 const html='<title>Produkty</title><script>$(".g-recaptcha"); var src="https://www.google.com/recaptcha/api.js";</script><p>Niestety, nie znaleźliśmy produktów, których szukasz.</p>';
 const r=await scanMarketplace(task('Dedalus.pl'),{pause:async()=>{},fetcher:async()=>new Response(html,{headers:{'content-type':'text/html'}})});
 assert.deepEqual(r.offers,[]);
 for(const page of ['<title>CAPTCHA</title>','<h1>Verify you are human</h1>','<div class="g-recaptcha"></div>','<script src="/cdn-cgi/challenge-platform/h/g/orchestrate"></script>','<iframe src="https://geo.captcha-delivery.com/captcha/?x=1"></iframe>'])assert.equal(sourceChallenge(page),true);
});
test('Tezeusz current price excludes variant counts, old prices and ranges',()=>{
 const card=(id,price)=>`<a class='tezeusz-product-card' href='/warhammer-${id}'><img alt='Warhammer książka'><div>Dostępne warianty: 1</div>${price}</a>`;
 const html=card(1,"<div class='tezeusz-product-card-price'>192,03 zł<div class='tezeusz-product-card-oldprice'>240 zł</div></div>")+card(2,"<div class='tezeusz-product-card-price-range'>od 100 zł do 200 zł</div>")+card(3,"<div class='tezeusz-product-card-price tezeusz-product-card-price-empty'>&nbsp;</div>");
 const rows=parseMarketplace(html,task('Tezeusz.pl'));assert.equal(rows.length,1);assert.equal(rows[0].price,19203);
});
test('Dedalus accepts product paths and JSON-LD descriptions with literal newlines',()=>{
 const html='<script type="application/ld+json">{"@type":"Product","name":"Warhammer książka","description":"line one\nline two","url":"https://dedalus.pl/tanie-ksiazki/fantastyka/warhammer","offers":{"@type":"Offer","price":"39.00","priceCurrency":"PLN"}}</script>';
 const rows=parseMarketplace(html,task('Dedalus.pl'));assert.equal(rows.length,1);assert.equal(rows[0].price,3900);assert.equal(rows[0].priceConfirmed,false);
});
test('Dedalus empty results do not import recommendations',()=>{
 const html='<p>Niestety, nie znaleźliśmy produktów, których szukasz.</p><script type="application/ld+json">{"@type":"Product","name":"Warhammer książka","url":"https://dedalus.pl/warhammer","offers":{"price":30}}</script>';
 assert.deepEqual(parseMarketplace(html,task('Dedalus.pl')),[]);
});
for(const [source,host,url] of [['Allegro','allegro.pl','https://allegro.pl/oferta/warhammer-book-123456789'],['Empik','www.empik.com','https://www.empik.com/warhammer-book,p123456789,ksiazka-p']]){
 test(`${source}: exact product price only, safe URL and unconfirmed availability`,async()=>{
 const task={source,host,mode:'watchlist',title:'Warhammer',page:1,paginationVersion:1};
 const product=(url,offers)=>({'@type':'Product',name:'Warhammer książka',url,offers});
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'ItemList',itemListElement:[product(url,{'@type':'Offer',price:'29.90',priceCurrency:'PLN'}),product(url+'-range',{'@type':'AggregateOffer',lowPrice:'1',priceCurrency:'PLN'}),product('https://evil.test/oferta/book-123',{'@type':'Offer',price:1,priceCurrency:'PLN'})]})+'</script>';
 const result=await scanMarketplace(task,{pause:async()=>{},fetcher:async()=>new Response(html,{headers:{'content-type':'text/html'}})});
 assert.equal(result.offers.length,1);assert.equal(result.offers[0].price,2990);assert.equal(new URL(result.offers[0].url).hostname,host);assert.equal(result.offers[0].availability,'unconfirmed');assert.equal(result.pagination.state,'unknown');
 assert.throws(()=>parseMarketplace('<h1>Search</h1>',task),/UNRECOGNIZED/);
 });
}
