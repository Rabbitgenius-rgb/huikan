import {packager} from '@electron/packager';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {macReleaseOptions} from './mac-release-options.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='darwin')throw Error('请在 macOS 上构建 macOS 安装包。');
const args=process.argv.slice(2);
if(args.some(value=>!['--release','--check-release'].includes(value)))throw Error('支持的参数：--release、--check-release');
const release=args.includes('--release')||args.includes('--check-release');
let releaseOptions={};
if(release){
 const identities=execFileSync('/usr/bin/security',['find-identity','-v','-p','codesigning'],{encoding:'utf8'});
 releaseOptions=macReleaseOptions({identities,identity:process.env.HUIKAN_SIGN_IDENTITY||'',keychainProfile:process.env.HUIKAN_NOTARY_PROFILE||''});
 if(args.includes('--check-release')){console.log('本机发布配置检查通过；尚未提交 Apple 公证。');process.exit(0);}
}
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const out=path.resolve(process.env.HUIKAN_PACKAGE_OUT||path.join(root,release?'../huikan-release/notarized':'../huikan-release'));
const bagProfile=process.env.HUIKAN_BAG_PREVIEW_PROFILE;
if(bagProfile && (release || !path.isAbsolute(bagProfile)))throw Error('书包候选必须使用本地绝对资料目录');
const name=bagProfile?'回看书包候选':'回看';
const config=path.join(root,'desktop/build/bag-preview-config.json');
let apps, createdConfig=false;
try {
 if(bagProfile){await fs.writeFile(config,JSON.stringify({profile:bagProfile}),{flag:'wx'});createdConfig=true;}
 apps=await packager({dir:path.join(root,'desktop/build'),out,name,executableName:bagProfile?'HuikanBag':'Huikan',icon:path.join(root,'desktop/assets/icon.icns'),appBundleId:bagProfile?'io.huikan.desktop.bag-preview':'io.huikan.desktop',appVersion:version,electronVersion:'44.4.5',platform:'darwin',arch:'arm64',asar:false,prune:false,overwrite:true,...releaseOptions,...(process.env.HUIKAN_ELECTRON_ZIP_DIR?{electronZipDir:path.resolve(process.env.HUIKAN_ELECTRON_ZIP_DIR)}:{})});
} finally {
 if(createdConfig)await fs.rm(config,{force:true});
}
const app=path.join(apps[0],name+'.app');
if(release){
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
 execFileSync('/usr/bin/xcrun',['stapler','validate',app],{stdio:'inherit'});
 execFileSync('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',app],{stdio:'inherit'});
}else execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
const zip=path.join(out,`Huikan-${bagProfile?'Bag-':''}${version}-mac-arm64.zip`);
execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,zip]);
console.log(zip);
