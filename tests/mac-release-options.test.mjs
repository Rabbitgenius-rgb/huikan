import test from 'node:test';
import assert from 'node:assert/strict';
import {macReleaseOptions} from '../scripts/mac-release-options.mjs';
const first='A'.repeat(40),second='B'.repeat(40);
const developer=`1) ${first} "Apple Development: Test (TESTTEAM)"`;
const distribution=`1) ${first} "Developer ID Application: Test (TESTTEAM)"`;
test('release rejects a testing identity or missing certificate instead of falling back to ad hoc',()=>{
 for(const identities of ['',developer])assert.throws(()=>macReleaseOptions({identities,keychainProfile:'fixture'}),/未找到可用/);
});
test('release requires a selected distribution identity when multiple certificates are available',()=>{
 const identities=distribution+`\n2) ${second} "Developer ID Application: Other (OTHERTEAM)"`;
 assert.throws(()=>macReleaseOptions({identities,keychainProfile:'fixture'}),/指定一个/);
 assert.throws(()=>macReleaseOptions({identities,identity:'not-found',keychainProfile:'fixture'}),/指定一个/);
 assert.equal(macReleaseOptions({identities,identity:second,keychainProfile:'fixture'}).osxSign.identity,second);
});
test('release requires a Keychain profile, fails on signing errors and enables only the required JIT entitlement',()=>{
 assert.throws(()=>macReleaseOptions({identities:distribution}),/钥匙串/);
 const options=macReleaseOptions({identities:distribution,keychainProfile:'fixture'});
 assert.equal(options.osxSign.continueOnError,false);
 assert.equal(options.osxSign.strictVerify,true);
 assert.deepEqual(options.osxSign.optionsForFile(),{hardenedRuntime:true,entitlements:['com.apple.security.cs.allow-jit']});
 assert.deepEqual(options.osxNotarize,{keychainProfile:'fixture'});
});
