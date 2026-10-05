const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const stripTypeScriptTypes = typeof Bun !== 'undefined'
 ? source => new Bun.Transpiler({loader:'ts'}).transformSync(source)
 : require('node:module').stripTypeScriptTypes;
async function handler() {
 if (typeof Bun !== 'undefined') {
  const {createFileEditorTool} = await import('../src/llm/tools/fileEditor.ts');
  return (input, context) => createFileEditorTool(context).execute(input, {toolCallId:'synthetic',messages:[]});
 }
 const source = fs.readFileSync(path.join(__dirname,'../src/llm/tools/fileEditor.ts'),'utf8');
 const body = source.slice(source.indexOf('const fileBackups'),source.indexOf('/**\n * Creates a file editor'));
 const context={fs,path,normalizePath:p=>p.replace(/\\/g,'/')};vm.createContext(context);
 vm.runInContext(stripTypeScriptTypes(body)+'\nthis.handle = handleToolUse;',context);return context.handle;
}
test('file editor stays within vault for sibling and symlink paths',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vibesidian-test-'));
 try {
  const base=path.join(root,'vault'), outside=path.join(root,'vault-other');
  fs.mkdirSync(base);fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret'),'synthetic outside');
  fs.symlinkSync(outside,path.join(base,'escape'),'dir');
  const run=await handler();const context={basePath:base};
  for(const target of ['../vault-other/secret','escape/secret',path.join(outside,'secret')]) {
   assert.match(await run({command:'view',path:target},context),/Security error/);
   assert.match(await run({command:'insert',path:target,insert_line:0,new_str:'changed'},context),/Security error/);
   assert.match(await run({command:'undo_edit',path:target},context),/Security error/);
   assert.match(await run({command:'str_replace',path:target,old_str:'synthetic',new_str:'changed'},context),/Security error/);
  }
  for(const target of ['../vault-other/new','escape/deep/new']) {
   assert.match(await run({command:'create',path:target,file_text:'test'},context),/Security error/);
  }
  fs.symlinkSync(path.join(outside,'missing'),path.join(base,'dangling'));
  assert.match(await run({command:'create',path:'dangling',file_text:'test'},context),/^Error:/);
  assert.equal(fs.existsSync(path.join(outside,'missing')),false);
  assert.equal(fs.readFileSync(path.join(outside,'secret'),'utf8'),'synthetic outside');
  assert.deepEqual(fs.readdirSync(outside),['secret']);
  assert.match(await run({command:'create',path:'deep/note',file_text:'inside'},context),/Successfully/);
  assert.equal(await run({command:'view',path:'deep/note'},context),'inside');
  fs.symlinkSync(path.join(base,'deep'),path.join(base,'safe-link'),'dir');
  assert.equal(await run({command:'view',path:'safe-link/note'},context),'inside');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
