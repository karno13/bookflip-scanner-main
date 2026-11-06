import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('review layout cannot override the hidden state of an inactive tab',async()=>{
  const workflow=await readFile(new URL('./app/workflow.css',import.meta.url),'utf8');
  const layouts=[...workflow.matchAll(/(#view-review[^\s,{]*)\s*\{([^{}]*)\}/g)]
    .filter(([,selector,body])=>/\bdisplay\s*:\s*(?:flex|grid|block)\b/.test(body));
  // The redesigned shell uses the shared .view layout instead of review-specific visibility.
  assert.ok(!/display\s*:\s*contents/.test(workflow), 'review children retain their semantic layout');
  for(const [,selector] of layouts)
    assert.ok(selector.includes(':not([hidden])'),'inactive review must not receive visible layout: '+selector);
});

test('the last stylesheet enforces hidden visibility for every tab and control',async()=>{
  const html=await readFile(new URL('./app/index.html',import.meta.url),'utf8');
  const css=await readFile(new URL('./app/trading.css',import.meta.url),'utf8');
  assert.match(css,/(?:^|\})\s*\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/m);
  assert.ok(html.indexOf('href=/trading.css')>html.indexOf('href=/workflow.css'));
});
