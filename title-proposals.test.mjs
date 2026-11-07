import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeProposal,
  extractVolume,
  jobsNeedingProposal,
  loadProposal,
  rankCandidates,
  scoreCandidate,
  searchVariants,
} from './title-proposals.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

// Shapes copied from real BN title-search answers.
const raisingSteam = {
  isbn: '9788378397519',
  title: 'Para w ruch / Raising steam, Discworld series',
  authorText: 'Pratchett, Terry (1948-2015) Cholewa, Piotr W. (1955- ) Prószyński Media',
  language: 'polski',
  publicationYear: '2014',
};
const exhibition = {
  isbn: '9788363959081',
  title: 'Para, buch! Koła, w ruch! : katalog wystawy w Muzeum w Rybniku / Katalog wystawy',
  authorText: 'Keller, Dawid',
  language: 'polski',
  publicationYear: '2015',
};

test('extractVolume reads the usual Polish volume markers', () => {
  assert.equal(extractVolume('Para w ruch. Świat dysku. Tom 40'), 40);
  assert.equal(extractVolume('Herezja Horusa tom 15 | Warhammer'), 15);
  assert.equal(extractVolume('Dragonlance: Świt Nowej Ery'), null);
});

test('the book named in the listing outranks look-alike titles', () => {
  const offer = 'Para w ruch. Świat dysku. Tom 40';
  assert.ok(scoreCandidate(offer, raisingSteam) >= 0.85);
  assert.ok(scoreCandidate(offer, exhibition) < 0.6);
  const ranked = rankCandidates(offer, [exhibition, raisingSteam]);
  assert.equal(ranked.candidates[0].isbn, raisingSteam.isbn);
  assert.equal(ranked.confidence, 'high');
});

test('a volume number that contradicts the catalogue lowers the score sharply', () => {
  const volume12 = { ...raisingSteam, title: 'Wyprawa czarownic / Witches abroad ; t. 12' };
  const ok = scoreCandidate('Wyprawa czarownic. Świat dysku. Tom 12', volume12);
  const wrong = scoreCandidate('Wyprawa czarownic. Świat dysku. Tom 13', volume12);
  assert.ok(ok > 0.85);
  assert.ok(wrong < ok * 0.5);
});

test('foreign-language catalogue records are down-weighted for a Polish listing', () => {
  const german = { ...raisingSteam, language: 'niemiecki' };
  assert.ok(scoreCandidate('Para w ruch', german) < scoreCandidate('Para w ruch', raisingSteam));
});

test('a close rival with a different title makes the proposal ambiguous, other editions do not', () => {
  const offer = 'Alfa Beta Gamma Delta Epsilon';
  const book = { isbn: '9788375060041', title: 'Alfa beta gamma delta epsilon', language: 'polski' };
  const reprint = { isbn: '9788375060874', title: 'Alfa beta gamma delta epsilon', language: 'polski' };
  const rival = { isbn: '9788386758289', title: 'Alfa beta gamma delta epsilon zeta', language: 'polski' };
  assert.equal(rankCandidates(offer, [book, reprint]).confidence, 'high');
  assert.notEqual(rankCandidates(offer, [book, rival]).confidence, 'high');
});

test('search variants drop seller noise and universe names, most specific first', () => {
  const variants = searchVariants('Książka Warhammer Herezja Horusa Vulkan Żyje | Dan Abnett | Tom 26 (nowa)');
  assert.ok(variants.length >= 2 && variants.length <= 4);
  assert.ok(variants.every((phrase) => !/\(nowa\)/i.test(phrase)));
  assert.ok(variants.some((phrase) => /vulkan/i.test(phrase) && !/warhammer/i.test(phrase)));
  assert.deepEqual(searchVariants('ab'), []);
  // Author tail removed: the catalogue title is "Cisza przed burzą".
  assert.ok(searchVariants('Cisza przed burzą Warcraft Christie Golden').includes('Cisza przed burzą Warcraft'));
});

function setup() {
  const repository = new SqliteCatalogRepository(':memory:');
  const offer = repository.upsertOffer({
    source: 'Empik',
    normalizedUrl: 'https://www.empik.com/x',
    originalTitle: 'Para w ruch. Świat dysku. Tom 40',
    currentPrice: 3000,
  });
  const job = repository.putIdentificationJob({ offerId: offer.id, status: 'review_required' });
  return { repository, offer, job };
}

test('a proposal is computed once, stored, and the job no longer needs one', async () => {
  const { repository, job } = setup();
  const asked = [];
  const catalog = {
    repository,
    findIsbnsByTitle: async (query) => {
      asked.push(query);
      return { candidates: [exhibition, raisingSteam], unavailable: [] };
    },
  };
  assert.equal(jobsNeedingProposal(repository).length, 1);
  const row = repository.database
    .prepare('SELECT j.id,j.offer_id,o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id')
    .get();
  const result = await computeProposal(catalog, row);
  assert.equal(result.confidence, 'high');
  assert.equal(asked.length, 1, 'a confident first hit needs no more requests');
  const stored = loadProposal(repository, job.id);
  assert.equal(stored.candidates[0].isbn, raisingSteam.isbn);
  assert.equal(jobsNeedingProposal(repository).length, 0);
});

test('a source outage is not cached as "no proposal"', async () => {
  const { repository } = setup();
  const catalog = { repository, findIsbnsByTitle: async () => ({ candidates: [], unavailable: ['bn'] }) };
  const row = repository.database
    .prepare('SELECT j.id,j.offer_id,o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id')
    .get();
  const result = await computeProposal(catalog, row);
  assert.equal(result.stored, false);
  assert.equal(jobsNeedingProposal(repository).length, 1);
});
