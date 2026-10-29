import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceChallenge,scanMarketplace,parseMarketplace,searchUrl} from './marketplaces.mjs';
const task=source=>({source,host:source==='Tezeusz.pl'?'tezeusz.pl':'dedalus.pl',mode:'watchlist',title:'Warhammer'});
test('Cloudflare passive JSD does not imply an access challenge',()=>{
 const passive='<script>var u="/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=test";</script>';
 assert.equal(sourceChallenge('<title>Produkty</title>'+passive),false);
 assert.equal(sourceChallenge('<h1>Verify you are human</h1>'+passive),true);
 assert.equal(sourceChallenge('<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'),true);
 assert.equal(sourceChallenge("<script>var dd={'host':'geo.captcha-delivery.com'}</script>"),true);
});
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

const empikTask={source:'Empik',host:'www.empik.com',mode:'watchlist',title:'Warcraft',page:1,paginationVersion:1};
const empikCard=({id='p1730634714',title='World of Warcraft. Więzy krwi',price='46.99',declared=price,path=`/world-of-warcraft-wiezy-krwi,p${id.slice(1)},ksiazka-p`,currency='PLN',ean='9788388916014'}={})=>`<div class="search-list-item js-reco-product ta-product-tile" data-product-id="${id}" data-product-name="${title}" data-product-price="${declared}" data-product-ean="${ean}" itemprop="itemListElement"><a href="${path}" class="seoTitle" itemprop="url" data-product-id="${id}"><strong itemprop="name">${title}</strong></a><div itemprop="offers"><div class="price" itemprop="price" content="${price}">${price} zł</div><meta itemprop="priceCurrency" content="${currency}"><span class="old-price">999,99 zł</span></div></div>`;

test('Empik parses live search cards and keeps title, product URL and current PLN price in one card',()=>{
 const html='<div class="search-content js-search-content" itemtype="https://schema.org/ItemList">'+empikCard()+empikCard({id:'p111',title:'World of Warcraft książka',price:'10',declared:'11',path:'/world-of-warcraft,p111,ksiazka-p'})+empikCard({id:'p222',title:'World of Warcraft książka',path:'/world-of-warcraft,p999,ksiazka-p'})+'</div>';
 const rows=parseMarketplace(html,empikTask);
 assert.equal(rows.length,1);assert.equal(rows[0].title,'World of Warcraft. Więzy krwi');assert.equal(rows[0].price,4699);assert.equal(rows[0].isbn,'9788388916014');assert.equal(rows[0].url,'https://www.empik.com/world-of-warcraft-wiezy-krwi,p1730634714,ksiazka-p');
});

test('bookstore JSON-LD preserves only a checksum-valid ISBN',()=>{const valid='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Warhammer książka',isbn:'9788388916014',url:'https://dedalus.pl/tanie-ksiazki/warhammer',offers:{'@type':'Offer',price:'39.00',priceCurrency:'PLN'}})+'</script>',invalid=valid.replace('9788388916014','9788388916015');assert.equal(parseMarketplace(valid,task('Dedalus.pl'))[0].isbn,'9788388916014');assert.equal(parseMarketplace(invalid,task('Dedalus.pl'))[0].isbn,undefined);});

test('Empik recognizes a real empty result container but rejects an unknown 200 page',()=>{
 assert.deepEqual(parseMarketplace('<div class="search-content js-search-content" itemtype="https://schema.org/ItemList"></div>',empikTask),[]);
 assert.throws(()=>parseMarketplace('<main>layout changed</main>',empikTask),/UNRECOGNIZED_MARKETPLACE_DATA/);
});

test('Empik uses sixty-result pagination and accepts its lowercase canonical query',async()=>{
 const html='<div class="search-content js-search-content" itemtype="https://schema.org/ItemList">'+empikCard()+'</div><a href="/szukaj/produkt?start=61&q=warcraft&qtype=basicForm " class="arrow next ta-next-page"><i></i></a>';
 const result=await scanMarketplace(empikTask,{pause:async()=>{},fetcher:async()=>new Response(html,{headers:{'content-type':'text/html'}})});
 assert.equal(result.pagination.state,'more');assert.equal(result.pagination.nextPage,2);assert.equal(new URL(searchUrl({...empikTask,page:2})).searchParams.get('start'),'61');
});
