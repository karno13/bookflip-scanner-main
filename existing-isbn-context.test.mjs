import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { CatalogResolver } from './catalog-resolver.mjs';

const isbn = '9780306406157';

test('existing verified edition is matched when auction title has additional words', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const work = repo.createWork({title:'Posłaniec śmierci', authors:['Dan Abnett']});
    const edition = repo.createEdition({workId:work.id,title:'Posłaniec śmierci / Death Messenger, Warhammer',publicationYear:2008});
    repo.attachIdentifier(edition.id,'isbn13',isbn,{source:'test'});
    const offer = repo.upsertOffer({source:'test',normalizedUrl:'https://example.test/offer',originalTitle:'Warhammer-Posłaniec śmierci',observedIsbn:isbn});
    repo.putMetadataEvidence({id:'evidence-test',offerId:offer.id,fieldName:'isbn',value:isbn,classification:'structured',sourceType:'scanner:test'});
    const result = await new CatalogResolver({repository:repo,lookupMetadata:async()=>{throw Error('LOOKUP_NOT_EXPECTED');}}).resolve({offerId:offer.id});
    assert.equal(result.decision,'matched_existing');
    assert.equal(result.editionId,edition.id);
  } finally {repo.close();}
});
test('unrelated title with valid ISBN stays in review', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const work = repo.createWork({title:'Posłaniec śmierci'});
    const edition = repo.createEdition({workId:work.id,title:'Posłaniec śmierci'});
    repo.attachIdentifier(edition.id,'isbn13',isbn,{source:'test'});
    const offer = repo.upsertOffer({source:'test',normalizedUrl:'https://example.test/another',originalTitle:'Completely Unrelated Collection',observedIsbn:isbn});
    repo.putMetadataEvidence({id:'evidence-other',offerId:offer.id,fieldName:'isbn',value:isbn,classification:'structured',sourceType:'scanner:test'});
    const result = await new CatalogResolver({repository:repo,lookupMetadata:async()=>{throw Error('LOOKUP_NOT_EXPECTED');}}).resolve({offerId:offer.id});
    assert.equal(result.decision,'review_required');
  } finally {repo.close();}
});
