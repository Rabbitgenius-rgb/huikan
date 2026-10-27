export function macReleaseOptions({identities='',identity='',keychainProfile=''}) {
 const available=[...identities.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application: [^"]+)"/gm)].map(match=>({hash:match[1],name:match[2]}));
 if(!available.length)throw Error('未找到可用的 Developer ID Application 发布证书。请先开通 Apple Developer Program，再通过 Xcode 配置发布证书；Apple Development 测试证书不能用于此发布流程。');
 const chosen=identity?available.filter(value=>value.hash.toLowerCase()===identity.toLowerCase()||value.name===identity):available;
 if(chosen.length!==1)throw Error('请用 HUIKAN_SIGN_IDENTITY 指定一个有效的 Developer ID Application 证书标识。');
 if(typeof keychainProfile!=='string'||!keychainProfile.trim()||keychainProfile.length>128||/[\x00-\x1f]/.test(keychainProfile))throw Error('请先将公证凭据保存在 macOS 钥匙串，再用 HUIKAN_NOTARY_PROFILE 指定配置名称。');
 return {
  osxSign:{identity:chosen[0].hash,continueOnError:false,strictVerify:true,preAutoEntitlements:false,optionsForFile:()=>({hardenedRuntime:true,entitlements:['com.apple.security.cs.allow-jit']})},
  osxNotarize:{keychainProfile:keychainProfile.trim()},
 };
}
