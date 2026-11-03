import test from 'node:test';
import assert from 'node:assert/strict';
import { searchOffers } from './local-app.mjs';

test('Vinted detail reads are bounded to two in-flight requests and preserve offer ordering', async () => {
  let active = 0, peak = 0;
  const offers = [1,2,3,4].map(i => ({
    title:'Warcraft tome '+i, price:100+i,
    url:'https://www.vinted.pl/items/'+i+'-warcraft',
  }));
  const result = await searchOffers({queries:['Warcraft'],sources:['Vinted']},{
    scanner: async () => ({offers,pagination:{page:1,state:'end'}}),
    languageReader: async () => {
      active++;
      peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,10));
      active--;
      return {language:'Polski'};
    },
    retryWait: async () => {},
  });
  assert.ok(peak <= 2, 'maximum two concurrent requests');
  assert.ok(peak >= 2, 'should overlap slow detail responses');
  assert.equal(result.offers.length,4);
  assert.deepEqual(result.offers.map(row=>row.url),offers.map(row=>row.url));
});

test('known Vinted details do not require new network requests', async () => {
  let networkCalls = 0;
  const item = {title:'Warcraft',price:100,url:'https://www.vinted.pl/items/123-warcraft'};
  const cache = new Map([[item.url,{language:'Polski'}]]);
  const result = await searchOffers({queries:['Warcraft'],sources:['Vinted']},{
    scanner:async()=>({offers:[item],pagination:{page:1,state:'end'}}),
    languageReader:async()=>{networkCalls++;return {language:'Polski'};},
    detailCache:cache,
  });
  assert.equal(networkCalls,0);
  assert.equal(result.offers.length,1);
});
