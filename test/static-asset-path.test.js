import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAssetPath } from '../static-asset-path.mjs';

test('public assets include first-party browser modules without a manual route list', () => {
  assert.equal(publicAssetPath('/'), 'index.html');
  assert.equal(publicAssetPath('/app.js'), 'app.js');
  assert.equal(publicAssetPath('/views/scanner.js'), 'views/scanner.js');
  assert.equal(publicAssetPath('/views/future-module.js'), 'views/future-module.js');
  assert.equal(publicAssetPath('/core/formatters.js'), 'core/formatters.js');
  assert.equal(publicAssetPath('/workflow.css'), 'workflow.css');
});

test('public asset matching rejects arbitrary files, traversals and encoded paths', () => {
  for (const path of [
    '/.env', '/package.json', '/local-app.mjs', '/secrets.json',
    '/views/../.env', '/views/%2e%2e/.env',
    '/views/subdir/secret.js', '/core/.private.js',
    '/views/file.js/other', '/views/fake.js.map',
    '/core/%2e%2e%2fapp.js', '/backup.zip',
  ]) assert.equal(publicAssetPath(path), null, path);
});
