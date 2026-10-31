import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, dirname, resolve, extname, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const ignored = new Set(['.git','node_modules','scan-results','artifacts','docs']);
function requireSeparator() { return process.platform === 'win32' ? '\\\\' : '/'; }
function modules(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(item=>{
    if(item.isDirectory()) return ignored.has(item.name)?[]:modules(join(dir,item.name));
    return item.isFile() && item.name.endsWith('.mjs') ? [join(dir,item.name)] : [];
  });
}
test('all relative ESM imports resolve to checked-in files', () => {
  let checked=0;
  for(const file of modules(root)){
    const source=readFileSync(file,'utf8');
    // Static imports and re-exports; dynamic expressions require runtime tests.
    const refs=[...source.matchAll(/(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m=>m[1]);
    for(const ref of refs.filter(x=>x.startsWith('.'))){
      const destination=resolve(dirname(file),ref);
      const within=relative(root,destination);
      assert.ok(within!== '..' && !within.startsWith('..'+requireSeparator()) && !isAbsolute(within), `Import escapes repository: ${file} -> ${ref}`);
      assert.ok(extname(destination),`Import missing extension: ${file} -> ${ref}`);
      assert.ok(existsSync(destination),`Broken import: ${file} -> ${ref}`);
      checked++;
    }
  }
  assert.ok(checked>15,`Unexpectedly few checked imports: ${checked}`);
});
