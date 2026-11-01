import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { listOfferSets, markOfferAsSet, updateSetEdition, unmarkOfferSet } from './offer-sets.mjs';

test('bundle can contain multiple editions, keeps offer price and excludes single-book assignment', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const work = repo.createWork({title:'Test work'});
    const one = repo.createEdition({workId:work.id,title:'Volume One'});
    const two = repo.createEdition({workId:work.id,title:'Volume Two'});
    const offer = repo.upsertOffer({source:'test',normalizedUrl:'https://example.test/bundle',originalTitle:'Two volumes',currentPrice:4900});
    repo.assignOfferToEdition(offer.id,one.id,{method:'metadata'});
    markOfferAsSet(repo,offer.id);
    assert.equal(repo.database.prepare("SELECT count(*) AS n FROM offer_matches WHERE offer_id=? AND status='active'").get(offer.id).n,0);
    updateSetEdition(repo,offer.id,one.id,true);
    updateSetEdition(repo,offer.id,two.id,true);
    const list=listOfferSets(repo);
    assert.equal(list.length,1);
    assert.equal(list[0].currentPrice,4900);
    assert.equal(list[0].editions.length,2);
    updateSetEdition(repo,offer.id,one.id,false);
    assert.equal(listOfferSets(repo)[0].editions.length,1);
    unmarkOfferSet(repo,offer.id);
    assert.equal(listOfferSets(repo).length,0);
  } finally { repo.close(); }
});

test('bundle membership validates editions and offer existence', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    assert.throws(() => markOfferAsSet(repo,'missing'), /OFFER_NOT_FOUND/);
    const offer = repo.upsertOffer({source:'test',normalizedUrl:'https://example.test/other',originalTitle:'Set'});
    markOfferAsSet(repo,offer.id);
    assert.throws(() => updateSetEdition(repo,offer.id,'missing',true), /EDITION_NOT_FOUND/);
  } finally { repo.close(); }
});
