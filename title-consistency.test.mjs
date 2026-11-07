import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { titleConflict, findTitleConflicts, resolveTitleConflict } from './title-consistency.mjs';

test('one shared word (title, series, universe or author) is enough', () => {
  assert.equal(titleConflict('Warcraft wichry wojny', { title: 'Logik der Forschung', authors: ['Popper, Karl'] }), true);
  assert.equal(
    titleConflict('Zabójca Ludzi - Nathan Long Warhammer', { title: 'Społeczeństwo białoruskie, litewskie i polskie' }),
    true,
  );
  // Generic listing that names only the universe: same universe, no conflict.
  assert.equal(titleConflict('Książka Warcraft', { title: 'Durotan : oficjalny prequel filmu / Durotan, World of Warcraft' }), false);
  // Inflected Polish words match by stem.
  assert.equal(titleConflict('Warcraft wojna starożytnych', { title: 'Wojna starożytnych / War of the Ancients' }), false);
  // Author surname in the listing.
  assert.equal(titleConflict('Terry Pratchett - świat dysku', { title: 'Zimistrz / Wintersmith', authors: ['Pratchett, Terry'] }), false);
  // "Świat Dysku" on the listing, "Discworld" in the BN record.
  assert.equal(titleConflict('Świat Dysku 6 tomów', { title: 'Blask fantastyczny / Light fantastic, Discworld series' }), false);
  // Nothing comparable in the listing.
  assert.equal(titleConflict('Książka', { title: 'Logik der Forschung' }), false);
});

function fixture(repo) {
  const work = repo.createWork({ title: 'Logik der Forschung', authors: ['Popper, Karl'] });
  const edition = repo.createEdition({ workId: work.id, title: 'Logik der Forschung' });
  const offer = repo.upsertOffer({ source: 'test', normalizedUrl: 'https://example.test/wow', originalTitle: 'Warcraft wichry wojny' });
  repo.assignOfferToEdition(offer.id, edition.id, { method: 'structured_isbn' });
  return { work, edition, offer };
}

test('suspicious assignment can be sent back to review', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const { edition, offer } = fixture(repo);
    assert.deepEqual(findTitleConflicts(repo).map((row) => row.offerId), [offer.id]);
    resolveTitleConflict(repo, { offerId: offer.id, action: 'review' });
    assert.equal(findTitleConflicts(repo).length, 0);
    assert.equal(repo.counts().offer_matches, 1);
    assert.equal(repo.database.prepare("SELECT count(*) n FROM offer_matches WHERE status='active'").get().n, 0);
    const job = repo.database.prepare('SELECT status, result_json FROM identification_jobs WHERE offer_id=?').get(offer.id);
    assert.equal(job.status, 'review_required');
    assert.deepEqual(JSON.parse(job.result_json).reason, ['isbn_title_mismatch']);
    assert.equal(JSON.parse(job.result_json).editionId, edition.id);
  } finally {
    repo.close();
  }
});

test('confirmed assignment becomes manual and is not flagged again', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const { edition, offer } = fixture(repo);
    resolveTitleConflict(repo, { offerId: offer.id, action: 'confirm' });
    assert.equal(findTitleConflicts(repo).length, 0);
    const active = repo.database.prepare("SELECT edition_id, method FROM offer_matches WHERE offer_id=? AND status='active'").get(offer.id);
    assert.equal(active.edition_id, edition.id);
    assert.equal(active.method, 'manual');
    assert.throws(() => resolveTitleConflict(repo, { offerId: offer.id, action: 'nope' }), /INVALID_ACTION/);
  } finally {
    repo.close();
  }
});
