import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataComparisonMarkup } from './app/core/metadata-comparison.js';

const escapeHtml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
test('comparison displays source fields and sanitizes external data', () => {
  const markup = metadataComparisonMarkup({
    bn: { status:'found', records:[{title:'Book <script>alert(1)</script>', authors:['Author'], publicationYear:2000}], timing:{durationMs:14,cached:true}},
    openLibrary: {status:'not_found',records:[], timing:{durationMs:120,cached:false}},
    comparison: {status:'conflict', conflicts:[{type:'field_conflict',field:'title'}]},
  }, escapeHtml);
  assert.match(markup, /Biblioteka Narodowa/);
  assert.match(markup, /Open Library/);
  assert.match(markup, /14 ms/);
  assert.match(markup, /Konflikty/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});
