import test from 'node:test';
import assert from 'node:assert/strict';
import {watchForm,allowDiscard,hasUnsavedChanges} from './ux.js';
test('unsaved changes can be kept, discarded or saved with a new baseline',()=>{
  const previous=globalThis.confirm;
  const events={};const input={type:'text',value:'saved',addEventListener(name,callback){events[name]=callback;}};
  try {
    const saved=watchForm('test-form',[input]);input.value='draft';events.input();assert.equal(hasUnsavedChanges(),true);
    globalThis.confirm=()=>false;assert.equal(allowDiscard(),false);assert.equal(input.value,'draft');
    globalThis.confirm=()=>true;assert.equal(allowDiscard(),true);assert.equal(input.value,'saved');assert.equal(hasUnsavedChanges(),false);
    input.value='new save';saved();input.value='other draft';events.input();allowDiscard();assert.equal(input.value,'new save');
  }finally{globalThis.confirm=()=>true;allowDiscard();if(previous===undefined)delete globalThis.confirm;else globalThis.confirm=previous;}
});
