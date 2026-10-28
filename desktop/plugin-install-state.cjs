'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

function harnessHome(env=process.env,home=os.homedir()){
 const configured=typeof env.DSH_HOME==='string'&&env.DSH_HOME.trim()?env.DSH_HOME:path.join(home,'.dsh');
 const expanded=configured==='~'?home:/^~[/\\]/.test(configured)?path.join(home,configured.slice(2)):configured;
 return path.resolve(expanded);
}
function compareVersions(left,right){
 const parse=value=>typeof value==='string'&&value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
 const a=parse(left),b=parse(right);if(!a||!b)return null;
 for(let i=1;i<=3;i++){const difference=Number(a[i])-Number(b[i]);if(difference)return Math.sign(difference);}
 if(a[4]===b[4])return 0;if(!a[4])return 1;if(!b[4])return -1;
 const ap=a[4].split('.'),bp=b[4].split('.');
 for(let i=0;i<Math.max(ap.length,bp.length);i++){
  if(ap[i]===undefined)return -1;if(bp[i]===undefined)return 1;if(ap[i]===bp[i])continue;
  const an=/^\d+$/.test(ap[i]),bn=/^\d+$/.test(bp[i]);
  if(an&&bn)return Math.sign(Number(ap[i])-Number(bp[i]));if(an!==bn)return an?-1:1;return ap[i]<bp[i]?-1:1;
 }
 return 0;
}
async function metadata(file){
 const text=await fs.readFile(file,'utf8');const value=JSON.parse(text);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid manifest');return value;
}
// Inspect package metadata only; conversation data, credentials and user patch files are never read.
async function inspectPlugin({env=process.env,bundledPlugin}){
 const directory=path.join(harnessHome(env),'profiles','desktop');let profile;
 try{profile=await metadata(path.join(directory,'package.json'));}
 catch(error){return {setup:error.code==='ENOENT'?'needs-initialization':'profile-error',directory};}
 const name=bundledPlugin.name;
 const dependencies={...profile.devDependencies,...profile.optionalDependencies,...profile.dependencies};
 const spec=dependencies[name];
 if(spec===undefined)return {setup:'missing',directory};
 if(typeof spec!=='string')return {setup:'profile-error',directory};
 const development=/^(?:link|workspace|portal|git|github|gitlab|bitbucket):|^git\+/.test(spec)||/\.git(?:#|$)/.test(spec)||(/^file:/.test(spec)&&!/(?:\.tgz|\.tar\.gz)(?:[?#].*)?$/i.test(spec));
 if(development)return {setup:'development',directory};
 if(!Array.isArray(profile.dsh?.profile?.bundles)||!profile.dsh.profile.bundles.includes(name))return {setup:'disabled',directory};
 let installed;
 try{installed=await metadata(path.join(directory,'node_modules',...name.split('/'),'package.json'));}
 catch(error){return {setup:error.code==='ENOENT'?'missing-files':'profile-error',directory};}
 if(installed.name!==name)return {setup:'profile-error',directory};
 const version=installed.version,comparison=compareVersions(version,bundledPlugin.version);
 return {setup:comparison===null?'development':comparison===0?'current':comparison>0?'newer':'outdated',installedVersion:typeof version==='string'?version:undefined,directory};
}
module.exports={harnessHome,compareVersions,inspectPlugin};
