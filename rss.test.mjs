import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSprzedajemyAtom, sprzedajemyFeedUrl } from './rss.mjs';
const now = Date.now(),
  stamp = new Date(now).toISOString(),
  task = { mode: 'discovery', category: 'Warcraft' };
const entry = (
  title = 'Warcraft książka',
  price = '80,50',
  path = 'ksiazki-i-podreczniki/pozostale',
  id = '12345678',
) =>
  `<entry><title type="html"><![CDATA[${title}]]></title><summary type="html"><![CDATA[<strong>cena:</strong> ${price} zł<br/>]]></summary><updated>2026-01-01T00:00:00Z</updated><id>https://sprzedajemy.pl/warcraft-nr${id}?source=feed</id><category scheme="https://sprzedajemy.pl/kultura-i-rozrywka/${path}"/></entry>`;
const feed = (entries) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><updated>${stamp}</updated>${entries}</feed>`;
test('RSS supplies price evidence without claiming availability or a fresh listing update', () => {
  const [r] = parseSprzedajemyAtom(feed(entry()), task, now);
  assert.equal(r.price, 8050);
  assert.equal(r.url, 'https://sprzedajemy.pl/warcraft-nr12345678');
  assert.equal(r.activeConfirmed, false);
  assert.equal(r.priceConfirmed, false);
  assert.equal(r.availability, 'unconfirmed');
  assert.equal(r.priceEvidence, 'publisher_atom_feed');
  assert.equal(r.sourceUpdatedAt, '2026-01-01T00:00:00Z');
  assert.equal(r.observedAt, stamp);
});
test('excludes figurines, unrelated titles, missing price, invalid links and repeated offers', () => {
  const xml = feed(
    entry() +
      entry() +
      entry('Warcraft figurka', '30', 'gry-planszowe-i-fabularne') +
      entry('Inna książka') +
      entry('Warcraft', 'do uzgodnienia') +
      entry('Warcraft', '10', 'ksiazki-i-podreczniki', 'not-an-id'),
  );
  assert.equal(parseSprzedajemyAtom(xml, task, now).length, 1);
});
test('watchlist uses exact normalized title and safely encodes its feed query', () => {
  const t = { mode: 'watchlist', title: 'Król & Królowa', category: 'Fantastyka' };
  assert.equal(new URL(sprzedajemyFeedUrl(t)).searchParams.get('inp_text[v]'), t.title);
  assert.equal(parseSprzedajemyAtom(feed(entry('Król &amp; Królowa — używana')), t, now).length, 1);
});
test('rejects stale feeds, HTML, DTD and truncation; permits valid empty feeds', () => {
  assert.deepEqual(parseSprzedajemyAtom(feed(''), task, now), []);
  for (const xml of [
    '<html>captcha</html>',
    feed(entry()).replace(stamp, '2000-01-01T00:00:00Z'),
    '<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + feed(entry()),
    feed(entry()).slice(0, -7),
  ])
    assert.throws(() => parseSprzedajemyAtom(xml, task, now));
});
test('imports at most twenty candidates', () => {
  assert.equal(
    parseSprzedajemyAtom(
      feed(
        Array.from({ length: 40 }, (_, i) =>
          entry('Warcraft książka', '30', 'ksiazki-i-podreczniki/pozostale', String(12345678 + i)),
        ).join(''),
      ),
      task,
      now,
    ).length,
    20,
  );
});
