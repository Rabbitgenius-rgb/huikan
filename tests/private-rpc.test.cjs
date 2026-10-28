'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {startPrivateServer,callPrivate}=require('../shared/private-rpc.cjs');
test('private IPC transports exact text, rejects bad credentials, and releases its endpoint',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'huikan-rpc-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 let calls=0;
 const server=await startPrivateServer({directory,service:'test',handlers:{echo:params=>{calls++;return params;}}});
 t.after(()=>server.close());
 const file=path.join(directory,'test.json'),endpoint=JSON.parse(await fs.readFile(file,'utf8'));
 if(process.platform==='win32')assert.ok(endpoint.socketPath.startsWith('\\\\.\\pipe\\huikan-'));
 else assert.ok(endpoint.socketPath.endsWith('/rpc.sock'));
 const original={text:'保留原文\n```js\nconst answer = 42;\n```'};
 assert.deepEqual(await callPrivate({directory,service:'test',method:'echo',params:original}),original);
 await fs.writeFile(file,JSON.stringify({...endpoint,token:'0'.repeat(64)}));
 await assert.rejects(callPrivate({directory,service:'test',method:'echo'}),{code:'UNAUTHORIZED'});
 assert.equal(calls,1);
 await fs.writeFile(file,JSON.stringify({...endpoint,socketPath:'untrusted-endpoint'}));
 await assert.rejects(callPrivate({directory,service:'test',method:'echo'}),{code:'UNSAFE_ENDPOINT'});
 await fs.writeFile(file,JSON.stringify(endpoint));
 await server.close();
 await assert.rejects(callPrivate({directory,service:'test',method:'echo'}),{code:'SERVICE_UNAVAILABLE'});
 const restarted=await startPrivateServer({directory,service:'test',handlers:{echo:params=>params}});
 try{assert.deepEqual(await callPrivate({directory,service:'test',method:'echo',params:original}),original);}finally{await restarted.close();}
});
