'use strict';
// Electron presents app.asar as a virtual directory. Detection needs the physical
// archive, including its binary header, so it must bypass Electron's ASAR hooks.
const fs = process.versions.electron ? require('original-fs').promises : require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const SUPPORTED = new Set(['0.2.0-rc.2', '0.2.1-rc.3']);
const CLI_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js';
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?$/;
const run = (executable, args) => new Promise((resolve, reject) => {
  execFile(executable, args, { timeout: 4000, maxBuffer: 64 * 1024, windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
});

function powershell(script, env = process.env, execute = run) {
  const executable = path.win32.join(env.SystemRoot || env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`$ErrorActionPreference='Stop';${script}`, 'utf16le').toString('base64')]);
}

// Read only the bounded archive header and manifest; never execute the candidate application.
async function readAsarMetadata(archive, fsApi = fs) {
  const file = await fsApi.open(archive, 'r');
  try {
    const prefix = Buffer.alloc(16);
    if ((await file.read(prefix, 0, 16, 0)).bytesRead !== 16) throw Error('Invalid ASAR');
    const headerSize = prefix.readUInt32LE(12), dataOffset = 8 + prefix.readUInt32LE(4);
    if (headerSize < 2 || headerSize > 32 * 1024 * 1024 || dataOffset < 16 + headerSize || dataOffset > 33 * 1024 * 1024) throw Error('Invalid ASAR header');
    const header = Buffer.alloc(headerSize);
    if ((await file.read(header, 0, headerSize, 16)).bytesRead !== headerSize) throw Error('Incomplete ASAR header');
    const tree = JSON.parse(header.toString('utf8'));
    const entry = name => name.split('/').reduce((node, part) => node?.files?.[part], tree);
    const manifestEntry = entry('package.json'), cliEntry = entry(CLI_ENTRY);
    if (!manifestEntry || manifestEntry.unpacked || manifestEntry.link || !Number.isSafeInteger(manifestEntry.size) || manifestEntry.size < 2 || manifestEntry.size > 64 * 1024) throw Error('Invalid ASAR manifest');
    const offset = Number(manifestEntry.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid ASAR offset');
    const bytes = Buffer.alloc(manifestEntry.size);
    if ((await file.read(bytes, 0, bytes.length, dataOffset + offset)).bytesRead !== bytes.length) throw Error('Incomplete ASAR manifest');
    return { manifest: JSON.parse(bytes.toString('utf8')), cliPresent: !!cliEntry && !cliEntry.link && !cliEntry.unpacked && Number.isSafeInteger(cliEntry.size) && cliEntry.size > 0 };
  } finally { await file.close(); }
}

async function regularFile(file, fsApi) {
  const stat = await fsApi.lstat(file);
  return stat.isFile() && !stat.isSymbolicLink();
}

async function readRunning(executable, { platform = process.platform, env = process.env, execute = run } = {}) {
  try {
    if (platform === 'win32') {
      // Encode paths as data so quotes, spaces and non-ASCII usernames never become script code.
      const encoded = Buffer.from(executable, 'utf8').toString('base64');
      const output = await powershell(`
        $target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));
        $running=$false;$unknown=$false;
        foreach($p in [Diagnostics.Process]::GetProcessesByName('DeepSeek Harness')){
          try { if([string]::Equals($p.MainModule.FileName,$target,[StringComparison]::OrdinalIgnoreCase)){$running=$true} }
          catch { $unknown=$true } finally { $p.Dispose() }
        };
        if($running){'running'}elseif($unknown){'unknown'}else{'stopped'}
      `, env, execute);
      return output === 'running' ? true : output === 'stopped' ? false : null;
    }
    if (platform === 'darwin') {
      const output = await execute('/bin/ps', ['-axww', '-o', 'comm=']);
      return output.split(/\r?\n/).some(line => line.trim() === executable);
    }
  } catch { /* Unknown must never mean safely stopped. */ }
  return null;
}

async function listWindowsInstalls({ env = process.env, execute = run } = {}) {
  try {
    // Bounded .NET registry access avoids module imports and recursive registry scans.
    const output = await powershell(`
      $paths=[Collections.Generic.List[string]]::new();
      foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
        $base=$null;$key=$null;
        try {
          $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view);
          $key=$base.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall');
          if($null -ne $key){
            $names=$key.GetSubKeyNames();$limit=[Math]::Min($names.Length,2048);
            for($i=0;$i -lt $limit;$i++){
              $app=$null;try{
                $app=$key.OpenSubKey($names[$i]);
                if($null -ne $app -and $app.GetValue('DisplayName') -match '^DeepSeek Harness(?: [0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.]+)?(?:\\+[A-Za-z0-9.]+)?)?$'){
                  $location=$app.GetValue('InstallLocation');
                  if($location -is [string] -and $location.Length -lt 32768 -and $paths.Count -lt 32){$paths.Add($location)}
                }
              }finally{if($null -ne $app){$app.Dispose()}}
            }
          }
        }finally{if($null -ne $key){$key.Dispose()};if($null -ne $base){$base.Dispose()}}
      };
      foreach($location in $paths){[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($location))}
    `, env, execute);
    // ASCII-only output avoids PowerShell's console code page and Utility module loading.
    const lines = output.trim() ? output.trim().split(/\r?\n/) : [];
    if (lines.length > 32) return [];
    const values = [];
    for (const line of lines) {
      if (line.length > 131072 || line.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(line)) return [];
      const bytes = Buffer.from(line, 'base64');
      if (bytes.toString('base64') !== line) return [];
      const value = bytes.toString('utf8');
      if (value.length >= 32768 || !Buffer.from(value, 'utf8').equals(bytes)) return [];
      values.push(value);
    }
    return values;
  } catch { return []; }
}

async function inspectHarness(appPath, {
  platform = process.platform, env = process.env, fsApi = fs,
  readPlist = async (file, key) => run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', file]),
  readAsar = archive => readAsarMetadata(archive, fsApi),
  readRunning: inspectRunning = readRunning,
} = {}) {
  if (typeof appPath !== 'string' || appPath.includes('\0')) return null;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(appPath)) return null;
  try {
    if (platform === 'win32') {
      if (!/^[a-z]:[\\/]/i.test(appPath)) return null;
      let root = paths.normalize(appPath);
      if (paths.extname(root).toLowerCase() === '.exe') {
        if (paths.basename(root).toLowerCase() !== 'deepseek harness.exe') return null;
        root = paths.dirname(root);
      }
      const stat = await fsApi.lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      const executable = paths.join(root, 'DeepSeek Harness.exe');
      const archive = paths.join(root, 'resources', 'app.asar');
      // Official apps/desktop/cli/dsh.cmd launches this bundled runtime, not a global dsh command.
      for (const file of [executable, archive,
        paths.join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
        paths.join(root, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')]) {
        if (!await regularFile(file, fsApi)) return null;
      }
      const { manifest, cliPresent } = await readAsar(archive);
      if (manifest?.name !== '@deepseek-ai/dsh-desktop' || manifest?.dshDesktopAppId !== 'com.deepseek.dsh' || !VERSION.test(manifest.version) || !cliPresent) return null;
      const running = await inspectRunning(executable, { platform, env });
      return {
        installed: true, path: root, version: manifest.version, supported: SUPPORTED.has(manifest.version),
        cli: { command: executable, args: ['--expose-internals', paths.join(archive, ...CLI_ENTRY.split('/'))], env: { ELECTRON_RUN_AS_NODE: '1' } },
        running: running !== false, runningKnown: typeof running === 'boolean',
      };
    }
    if (platform !== 'darwin' || paths.extname(appPath) !== '.app') return null;
    const stat = await fsApi.lstat(appPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const plist = paths.join(appPath, 'Contents/Info.plist');
    if (await readPlist(plist, 'CFBundleIdentifier') !== 'com.deepseek.dsh') return null;
    const version = await readPlist(plist, 'CFBundleShortVersionString');
    if (!VERSION.test(version)) return null;
    const command = paths.join(appPath, 'Contents/Resources/runtime/cli/bin/dsh');
    if (!await regularFile(command, fsApi)) return null;
    const running = await inspectRunning(paths.join(appPath, 'Contents/MacOS/DeepSeek Harness'), { platform, env });
    return { installed: true, path: appPath, version, supported: SUPPORTED.has(version),
      cli: { command, args: [], env: {} }, running: running !== false, runningKnown: typeof running === 'boolean' };
  } catch { return null; }
}

async function detectHarness({ selectedPath, home = os.homedir(), platform = process.platform,
  env = process.env, inspect = inspectHarness, listWindowsInstalls: listInstalls = listWindowsInstalls } = {}) {
  if (platform !== 'darwin' && platform !== 'win32') return { installed: false, supported: false, reason: 'platform' };
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const candidates = [selectedPath, env.HUIKAN_HARNESS_APP];
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || paths.join(home, 'AppData', 'Local');
    candidates.push(...await listInstalls({ env }), paths.join(local, 'Programs', 'DeepSeek Harness'), paths.join(local, 'DeepSeek Harness'));
    if (env.ProgramFiles) candidates.push(paths.join(env.ProgramFiles, 'DeepSeek Harness'));
  } else candidates.push('/Applications/DeepSeek Harness.app', paths.join(home, 'Applications/DeepSeek Harness.app'));
  const seen = new Set();
  for (const target of candidates.filter(value => typeof value === 'string' && value)) {
    const normalized = platform === 'win32' ? paths.normalize(target).toLowerCase() : target;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const found = await inspect(target, { platform, env });
    if (found) return found;
  }
  return { installed: false, supported: false, reason: 'not-found' };
}

module.exports = { detectHarness, inspectHarness, SUPPORTED, readAsarMetadata, listWindowsInstalls, readRunning };
