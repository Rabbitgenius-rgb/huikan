'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const windows = process.platform === 'win32';
const aclCache = new Map();
async function fingerprint(file) {
  const s=await fs.lstat(file,{bigint:true});
  if(s.isSymbolicLink())throw unsafe('本机连接');
  return [s.dev,s.ino,s.ctimeNs,s.mtimeNs,s.birthtimeNs,s.size,s.mode].join(':');
}
function unsafe(kind) { return Object.assign(new Error(`${kind}的所有者或权限不安全`), {code:'UNSAFE_ENDPOINT'}); }
function assertPrivateStat(stat, kind) {
  if (stat.isSymbolicLink() || (!windows && ((typeof process.getuid === 'function' && stat.uid !== process.getuid()) || (stat.mode & 0o077)))) throw unsafe(kind);
}
// Windows mode bits do not describe NTFS permissions. Use the current user's SID,
// and fail closed if the system ACL tools are unavailable. Never emit the ACL/SID.
async function windowsAcl(paths, secure = false) {
  if (!windows) return;
  const fingerprints=await Promise.all(paths.map(fingerprint));
  const pending=paths.filter((file,index)=>secure||aclCache.get(file)?.fingerprint!==fingerprints[index]||aclCache.get(file)?.expires<Date.now());
  if(!pending.length)return;
  const script = `$ErrorActionPreference='Stop'; $stage='identity'; try {
    $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
    $paths=ConvertFrom-Json $env:HUIKAN_PRIVATE_PATHS;
    foreach($p in $paths) {
      $stage='file';
      $item=Get-Item -LiteralPath $p -Force;
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'unsafe'};
      $stage='read-acl'; $acl=Get-Acl -LiteralPath $p;
      $stage='owner';
      $owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;
      $allowed=@($sid.Value,'S-1-5-18','S-1-5-32-544');
      if($allowed -notcontains $owner){throw 'owner'};
      if($env:HUIKAN_PRIVATE_SECURE -eq '1') {
        $stage='directory';
        if(-not $item.PSIsContainer){throw 'directory'};
        $stage='create-acl'; $acl=[System.Security.AccessControl.DirectorySecurity]::new();
        $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false);
        $stage='create-rule';
        $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow);
        $acl.AddAccessRule($rule); $stage='write-acl'; Set-Acl -LiteralPath $p -AclObject $acl;
        $stage='read-acl';
        $acl=Get-Acl -LiteralPath $p;
      };
      $stage='permissions';
      if($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]).Count -eq 0){throw 'permissions'};
      foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
        if($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value){throw 'permissions'};
      };
    }; exit 0
  } catch { [Console]::Out.WriteLine('HUIKAN_ACL:'+ $stage + ':' + $_.Exception.GetType().Name); exit 1 }`;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  try {
    await run(executable, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], {
      windowsHide:true, timeout:15000, maxBuffer:1024,
      env:{...process.env,HUIKAN_PRIVATE_PATHS:JSON.stringify(pending),HUIKAN_PRIVATE_SECURE:secure?'1':'0'},
    });
    // NTFS ChangeTime (Node ctimeNs) changes with ACL metadata. Revalidate on any
    // metadata change, and at least every five seconds, without per-poll processes.
    for(const file of pending){
      const current=await fingerprint(file);
      if(!secure&&current!==fingerprints[paths.indexOf(file)])throw unsafe('本机连接');
      if(aclCache.size>128)aclCache.clear();
      aclCache.set(file,{fingerprint:current,expires:Date.now()+5000});
    }
  } catch(error) {
    const diagnostic=String(error.stdout||'').match(/HUIKAN_ACL:(identity|file|read-acl|owner|directory|create-acl|create-rule|write-acl|permissions):([A-Za-z]{1,80})/);
    const result=unsafe('本机连接');
    // Only fixed stages and exception type names are allowed into logs. Raw
    // PowerShell stderr can contain local paths and must never be exposed.
    result.message+=diagnostic?` (Windows ACL: ${diagnostic[1]}/${diagnostic[2]})`:' (Windows ACL: validation failed)';
    throw result;
  }
}
async function privateDirectory(directory) {
  const created=await fs.mkdir(directory,{recursive:true,mode:0o700});
  const stat=await fs.lstat(directory); assertPrivateStat(stat,'本机桥接目录');
  if(!stat.isDirectory())throw unsafe('本机桥接目录');
  // Do not rewrite permissions on an arbitrary existing configured directory.
  await windowsAcl([directory],Boolean(created));
}
async function readPrivateJson(file,maxSize=8192) {
  const before=await fs.lstat(file); assertPrivateStat(before,'本机桥接文件');
  await windowsAcl([path.dirname(file),file]);
  const handle=await fs.open(file,require('node:fs').constants.O_RDONLY | (require('node:fs').constants.O_NOFOLLOW || 0));
  try {
    const stat=await handle.stat(); assertPrivateStat(stat,'本机桥接文件');
    if(!stat.isFile()||stat.size>maxSize)throw unsafe('本机桥接文件');
    return JSON.parse(await handle.readFile('utf8'));
  } finally {await handle.close();}
}
module.exports={windows,assertPrivateStat,windowsAcl,privateDirectory,readPrivateJson};
