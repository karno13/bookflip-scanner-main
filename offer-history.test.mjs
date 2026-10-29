import test from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {applyScanToHistory,emptyOfferHistory,loadOfferHistory,migrateOfferHistory,saveOfferHistory,sourceOfferId} from './offer-history.mjs';

const isbn='9788388916014';
const offer={url:'https://www.vinted.pl/items/123-book?ref=search',source:'Vinted',title:'Książka',price:1000,matchedQueries:['Warcraft'],isbn,language:'Polski',availability:'unconfirmed'};

test('stable source IDs deduplicate tracking parameters and use marketplace IDs',()=>{assert.equal(sourceOfferId('Vinted',offer.url),'Vinted:123');assert.equal(sourceOfferId('Vinted','https://www.vinted.pl/items/123-book?foo=bar'),'Vinted:123');assert.equal(sourceOfferId('Empik','https://www.empik.com/book,p987,ksiazka-p'),'Empik:987');});

test('history keeps first sighting and only records actual price changes',()=>{const one=applyScanToHistory(emptyOfferHistory(),[offer],'2026-10-29T10:00:00Z'),two=applyScanToHistory(one.history,[offer],'2026-10-30T10:00:00Z'),three=applyScanToHistory(two.history,[{...offer,price:800}],'2026-11-02T10:00:00Z'),stored=three.history.offers['Vinted:123'];assert.equal(stored.firstSeenAt,'2026-10-29T10:00:00Z');assert.equal(stored.lastSeenAt,'2026-11-02T10:00:00Z');assert.equal(stored.seenCount,3);assert.equal(stored.bookId,`isbn:${isbn}`);assert.deepEqual(three.history.priceHistory.map(row=>row.price),[1000,800]);assert.equal(three.summary.new,0);assert.equal(three.summary.priceChanges,1);});

test('missing and invalid ISBN do not prevent saving an unlinked offer',()=>{const row=applyScanToHistory(emptyOfferHistory(),[{...offer,isbn:'123',url:'https://www.vinted.pl/items/456-book'}],'2026-10-29T10:00:00Z').history.offers['Vinted:456'];assert.equal(row.bookId,null);assert.equal(row.isbn,null);});

test('version 1 history migrates safely to books, offers and price history',()=>{const old={version:1,updatedAt:'2026-10-30T10:00:00Z',details:{},offers:{[offer.url]:{url:offer.url,source:offer.source,title:offer.title,isbn,firstSeenAt:'2026-10-29T10:00:00Z',lastSeenAt:'2026-10-30T10:00:00Z',seenCount:2,matchedQueries:['Warcraft'],prices:[{at:'2026-10-29T10:00:00Z',price:1000},{at:'2026-10-30T10:00:00Z',price:900}]}}},next=migrateOfferHistory(old);assert.equal(next.version,2);assert.equal(next.offers['Vinted:123'].currentPrice,900);assert.equal(next.priceHistory.length,2);assert.equal(next.books[`isbn:${isbn}`].isbn,isbn);});

test('saved history remains readable after an application restart',async()=>{const path=`scan-results/test-history-${process.pid}-${Date.now()}.json`;try{const history=applyScanToHistory(emptyOfferHistory(),[offer],'2026-10-29T10:00:00Z').history;await saveOfferHistory(history,path);const loaded=await loadOfferHistory(path);assert.equal(loaded.offers['Vinted:123'].currentPrice,1000);assert.equal(loaded.priceHistory.length,1);}finally{await rm(path,{force:true});}});
