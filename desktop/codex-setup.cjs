'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const BEGIN = '# BEGIN HUIKAN CODEX MCP v1';
const END = '# END HUIKAN CODEX MCP v1';
const failure = (code, message) => Object.assign(Error(message), { code });
const conflict = () => failure('CODEX_CONFIG_CONFLICT', 'Codex 中已有其他回看配置，请先在 Codex 的 MCP 设置中检查，回看未覆盖它。');
const publicError = error => error?.code?.startsWith('CODEX_') ? error : failure('CODEX_CONFIG_UNAVAILABLE', 'Codex 配置暂不可读取或写入，请检查本机权限后重试。');

// Locate real table/comment lines without mistaking text inside TOML strings
// for owned configuration. Other configuration is never parsed and serialized.
function configLines(text) {
  const rows = []; let quote = null, offset = 0;
  for (const raw of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const line = raw.replace(/\r?\n$/, ''), outside = quote === null; let end = line.length;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if ((quote === '"' || quote === '"""') && ch === '\\') { i++; continue; }
        if (line.startsWith(quote, i)) { i += quote.length - 1; quote = null; }
      } else if (ch === '#') { end = i; break; }
      else if (ch === '"' || ch === "'") { quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch; i += quote.length - 1; }
    }
    if (quote?.length === 1) throw failure('CODEX_CONFIG_UNSUPPORTED', 'Codex 配置格式暂不可识别，未修改配置。');
    rows.push({ line, code: outside ? line.slice(0, end).trim() : '', comment: outside && !line.slice(0, end).trim() ? line.trim() : '', start: offset, end: offset + raw.length });
    offset += raw.length;
  }
  if (quote) throw failure('CODEX_CONFIG_UNSUPPORTED', 'Codex 配置格式暂不可识别，未修改配置。');
  return rows;
}
function keys(value) {
  const parts = value.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[A-Za-z0-9_-]+)\s*(?:\.|$)/g);
  if (!parts || parts.join('').replace(/\s/g, '') !== value.replace(/\s/g, '')) return null;
  try { return parts.map(part => { const key = part.trim().replace(/\.$/, '').trim(); return key[0] === '"' ? JSON.parse(key) : key[0] === "'" ? key.slice(1, -1) : key; }); } catch { return null; }
}
function inspectConfiguration(text) {
  const rows = configLines(text), starts = rows.filter(row => row.comment === BEGIN), ends = rows.filter(row => row.comment === END);
  if (starts.length !== ends.length || starts.length > 1) throw conflict();
  const range = starts.length ? { start: starts[0].start, end: ends[0].end } : null;
  if (range && range.start >= ends[0].start) throw conflict();
  let table = [], owned = null, huikanTables = 0;
  for (const row of rows) {
    const inRange = range && row.start > range.start && row.end < range.end;
    const header = row.code.match(/^\[([^\[\]]+)\]$/);
    if (header) {
      table = keys(header[1].trim());
      if (!table) throw failure('CODEX_CONFIG_UNSUPPORTED', 'Codex 配置表名暂不可识别，未修改配置。');
      if (table[0] === 'mcp_servers' && table[1] === 'huikan') {
        if (table.length !== 2 || !inRange || ++huikanTables > 1) throw conflict();
        owned = {};
      } else if (inRange) throw conflict();
      continue;
    }
    const assignment = row.code.match(/^((?:"(?:\\.|[^"\\])*"|'[^']*'|[A-Za-z0-9_.-]|\s)+)=(.*)$/);
    const key = assignment ? keys(assignment[1].trim()) : null;
    if (key?.[0] === 'mcp_servers' || (table?.[0] === 'mcp_servers' && table.length === 1 && key?.[0] === 'huikan')) throw conflict();
    if (!inRange && assignment && table?.[0] === 'mcp_servers' && table[1] === 'huikan') throw conflict();
    if (inRange && row.code) {
      if (!owned || !assignment || !['command', 'args', 'env'].includes(key?.[0]) || key.length !== 1 || key[0] in owned) throw conflict();
      if (key[0] === 'env') {
        if (!/^\{\s*(?:ELECTRON_RUN_AS_NODE|"ELECTRON_RUN_AS_NODE"|'ELECTRON_RUN_AS_NODE')\s*=\s*(?:"1"|'1')\s*\}$/.test(assignment[2].trim())) throw conflict();
        owned.env = { ELECTRON_RUN_AS_NODE: '1' };
      } else try { owned[key[0]] = JSON.parse(assignment[2].trim()); } catch { throw conflict(); }
    }
    // An unowned subtable/array table is still a huikan configuration conflict.
    if (row.code.startsWith('[') && !header && /mcp_servers|huikan/.test(row.code)) throw conflict();
  }
  if (range && (!owned || typeof owned.command !== 'string' || !Array.isArray(owned.args) || owned.args.some(arg => typeof arg !== 'string') || Object.keys(owned).length !== (owned.env ? 3 : 2))) throw conflict();
  return { range, owned };
}

function createCodexSetup({ home = os.homedir(), env = process.env, command, args = [], runAsNode = false, getConnectionStatus = async () => null } = {}) {
  if (!path.isAbsolute(command || '') || !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0')) || command.includes('\0') || typeof runAsNode !== 'boolean') throw failure('CODEX_COMMAND_INVALID', '回看连接程序路径无效。');
  const custom = typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim() ? env.CODEX_HOME : null;
  const directory = custom || path.join(home, '.codex'), file = path.join(directory, 'config.toml');
  let pending = null;
  async function safeEntry(location, directoryExpected) {
    const stat = await fs.lstat(location);
    if (stat.isSymbolicLink() || (directoryExpected ? !stat.isDirectory() : !stat.isFile()) || (typeof process.getuid === 'function' && (stat.uid !== process.getuid() || (stat.mode & 0o022)))) throw failure('CODEX_CONFIG_UNSAFE', 'Codex 配置路径或权限不安全，未修改配置。');
    const canonical = await fs.realpath(location), requested = path.resolve(location);
    if (process.platform === 'win32' ? canonical.toLowerCase() !== requested.toLowerCase() : canonical !== requested) throw failure('CODEX_CONFIG_UNSAFE', 'Codex 配置路径包含符号链接，未修改配置。');
    return stat;
  }
  async function read(create = false) {
    if (!path.isAbsolute(directory)) throw failure('CODEX_CONFIG_UNSAFE', 'CODEX_HOME 必须是绝对目录，未修改配置。');
    try { await safeEntry(directory, true); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (custom) throw failure('CODEX_HOME_MISSING', '请先创建 CODEX_HOME 指定的 Codex 目录。');
      await safeEntry(home, true);
      if (!create) return { text: '', exists: false, parsed: inspectConfiguration('') };
      await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      await safeEntry(directory, true);
    }
    let stat, text = '';
    try { stat = await safeEntry(file, false); if (stat.size > 2 * 1024 * 1024) throw failure('CODEX_CONFIG_UNSUPPORTED', 'Codex 配置文件过大，未修改配置。'); text = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { text, exists: !!stat, parsed: inspectConfiguration(text) };
  }
  async function status() {
    let configured = false, collision = false, issue;
    try { const current = await read(); configured = current.parsed.owned?.command === command && JSON.stringify(current.parsed.owned?.args) === JSON.stringify(args) && Boolean(current.parsed.owned?.env) === runAsNode; if (current.parsed.owned && !configured) issue = '回看连接配置需要更新，点击连接 Codex 更新配置。'; }
    catch (error) { collision = error.code === 'CODEX_CONFIG_CONFLICT'; issue = publicError(error).message; }
    let connected = false;
    try { connected = (await getConnectionStatus())?.codex?.connected === true; } catch {}
    return { configured, conflict: collision, connected, needsRestart: configured && !connected, message: connected ? '已收到 Codex 连接握手，可在 Codex 中留作回看。' : issue || (configured ? '连接配置已保存，请重启 Codex 的 MCP 连接或重新打开 Codex。' : '点击连接 Codex，为本机 Codex 添加回看工具。') };
  }
  function install() {
    if (pending) return pending;
    pending = (async () => {
      const before = await read(true), eol = before.text.includes('\r\n') ? '\r\n' : '\n';
      const block = [BEGIN, '[mcp_servers.huikan]', `command = ${JSON.stringify(command)}`, `args = ${JSON.stringify(args)}`, ...(runAsNode ? ['env = { ELECTRON_RUN_AS_NODE = "1" }'] : []), END, ''].join(eol);
      const next = before.parsed.range ? before.text.slice(0, before.parsed.range.start) + block + before.text.slice(before.parsed.range.end) : before.text + (before.text && !before.text.endsWith('\n') ? eol : '') + (before.text ? eol : '') + block;
      if (next !== before.text) {
        const temporary = path.join(directory, `.huikan-config-${randomUUID()}.tmp`);
        try {
          const handle = await fs.open(temporary, 'wx', 0o600);
          try { await handle.writeFile(next, 'utf8'); await handle.sync(); } finally { await handle.close(); }
          const latest = await read();
          if (latest.text !== before.text || latest.exists !== before.exists) throw failure('CODEX_CONFIG_CHANGED', 'Codex 配置已被其他程序更新，请重新连接。');
          await fs.rename(temporary, file);
        } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      }
      return status();
    })().catch(error => { throw publicError(error); }).finally(() => { pending = null; });
    return pending;
  }
  return { status, install };
}
module.exports = { createCodexSetup };
