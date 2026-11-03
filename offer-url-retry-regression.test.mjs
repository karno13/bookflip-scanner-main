import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyOffer, normalizeOfferUrl, trustedOfferUrl } from './offer-identity.mjs';
import { retryDelay } from './local-app.mjs';
import { safeOfferHref } from './app/core/formatters.js';

test('reject unsafe marketplace offer URLs and source-domain mismatches', () => {
  for (const url of ['javascript:alert(1)','file:///etc/passwd',
    'http://www.vinted.pl/items/123','https://evil.example/items/123',
    'https://www.vinted.pl.evil.example/items/123',
    'https://user:pass@www.vinted.pl/items/123']) {
    assert.throws(()=>identifyOffer({source:'Vinted',url}),/UNSAFE_OFFER_URL|UNTRUSTED_OFFER_HOST/,url);
  }
  assert.equal(identifyOffer({source:'Vinted',url:'https://www.vinted.pl/items/123?utm_source=abc'}).id,'Vinted:123');
  assert.equal(trustedOfferUrl('Example','https://example.test/fixture'),'https://example.test/fixture');
  assert.throws(()=>normalizeOfferUrl('http://example.test/fixture'),/UNSAFE_OFFER_URL/);
});
test('browser external links refuse unsafe legacy protocols', () => {
  assert.equal(safeOfferHref('javascript:alert(1)'),'#');
  assert.equal(safeOfferHref('http://example.com/book'),'#');
  assert.equal(safeOfferHref('https://example.test/book'),'https://example.test/book');
});
test('retry-after headers are not shortened to default exponential cap', () => {
  assert.equal(retryDelay({status:429,retryAfter:180},1),180000);
  assert.equal(retryDelay({status:429,retryAfter:86400},1),86400000);
  assert.equal(retryDelay({status:429,retryAfter:null},1),1000);
  assert.equal(retryDelay({retryAfter:undefined},7),30000);
});
