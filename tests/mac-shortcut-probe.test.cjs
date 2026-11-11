'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createMacShortcutProbe} = require('../companion/src/mac-shortcut-probe.cjs');

test('the Mac probe uses an exact executable and supported accelerator without a shell', async () => {
  const calls = [];
  const probe = createMacShortcutProbe({executable:'/isolated/mac-shortcut-probe',runFile:(file,args,options,done)=>{
    calls.push({file,args,options}); done(null, JSON.stringify({available:args[0] === 'Command+Alt+K'}));
  }});
  assert.equal(await probe('Command+Shift+K'),false);
  assert.equal(await probe('Command+Alt+K'),true);
  assert.equal(await probe('Command+Q'),false); assert.equal(calls.length,2);
  assert.equal(calls[0].file,'/isolated/mac-shortcut-probe');
  assert.deepEqual(calls[0].args,['Command+Shift+K']);
  assert.equal(calls[0].options.shell,undefined); assert.equal(calls[0].options.timeout,2500);
  assert.throws(()=>createMacShortcutProbe({executable:'relative-probe'}),/路径/);
});

test('missing, timed-out or malformed Mac probe results cannot claim an available shortcut', async () => {
  for (const [error,output] of [[Error('timeout'),undefined],[null,'not JSON'],[null,'{"available":"yes"}']]) {
    const probe=createMacShortcutProbe({executable:'/isolated/mac-shortcut-probe',runFile:(_file,_args,_options,done)=>done(error,output)});
    await assert.rejects(probe('Command+Shift+K'),/检测/);
  }
});
