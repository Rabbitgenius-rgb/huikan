'use strict';
// Narrow authenticated same-user Unix IPC. Credentials stay in private discovery files.
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');

const FORMAT = 'mengcang-recall-rpc-v1';
const MAX_FRAME = 2 * 1024 * 1024;
const uid = () => typeof process.getuid === 'function' ? process.getuid() : null;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function serviceName(service) {
  if (typeof service !== 'string' || !/^[a-z][a-z0-9-]{0,30}$/.test(service)) throw failure('INVALID_SERVICE', '无效的本机服务名称');
  return service;
}
function paths(directory, service) {
  serviceName(service);
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw failure('INVALID_DIRECTORY', '本机桥接目录必须是绝对路径');
  directory = path.resolve(directory);
  const suffix = crypto.createHash('sha256').update(directory + '\0' + service).digest('hex').slice(0, 20);
  const socketDirectory = path.join(os.tmpdir().startsWith('/var/') ? '/private/tmp' : '/tmp', `mcr-${uid() ?? 'user'}-${suffix}`);
  return { directory, endpoint: path.join(directory, `${service}.json`), lock: path.join(directory, `${service}.lock`), socketDirectory, socketPath: path.join(socketDirectory, 'rpc.sock') };
}
function assertPrivate(stat, kind) {
  if (stat.isSymbolicLink() || (uid() !== null && stat.uid !== uid()) || (stat.mode & 0o077)) throw failure('UNSAFE_ENDPOINT', `${kind}的所有者或权限不安全`);
}
async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  assertPrivate(stat, '本机桥接目录');
  if (!stat.isDirectory()) throw failure('UNSAFE_ENDPOINT', '本机桥接目录不可用');
}
async function readPrivateJson(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assertPrivate(stat, '本机桥接文件');
    if (!stat.isFile() || stat.size > 8192) throw failure('UNSAFE_ENDPOINT', '本机桥接文件无效');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function atomicJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temp, file); } catch (error) { await fs.rm(temp, { force: true }); throw error; }
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
async function acquireLock(p, nonce) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(p.lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, nonce })); } finally { await handle.close(); }
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = await readPrivateJson(p.lock); }
      catch { throw failure('SERVICE_BUSY', '本机服务正在启动或锁文件不可用'); }
      if (alive(previous.pid)) throw failure('SERVICE_BUSY', '本机服务已经运行');
      await fs.unlink(p.lock);
    }
  }
  throw failure('SERVICE_BUSY', '本机服务锁定失败');
}
function authenticated(received, expected) {
  return typeof received === 'string' && /^[0-9a-f]{64}$/.test(received) && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
function wireError(error) {
  const known = typeof error?.code === 'string' && /^[A-Z0-9_-]{1,64}$/.test(error.code);
  return { code: known ? error.code : 'REQUEST_FAILED', message: typeof error?.message === 'string' ? error.message.slice(0, 1000) : '本机请求未完成' };
}

async function startPrivateServer({ directory, service, handlers }) {
  const p = paths(directory, service);
  if (!object(handlers) || !Object.keys(handlers).length || Object.entries(handlers).some(([name, fn]) => !/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(name) || typeof fn !== 'function')) throw failure('INVALID_HANDLERS', '本机服务方法无效');
  await privateDirectory(p.directory);
  await privateDirectory(p.socketDirectory);
  const token = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomUUID();
  await acquireLock(p, nonce);
  const connections = new Set(), pending = new Set();
  let closing = false;
  const server = net.createServer(socket => {
    connections.add(socket);
    let buffer = Buffer.alloc(0), accepted = false;
    socket.on('error', () => {});
    socket.on('close', () => connections.delete(socket));
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('data', chunk => {
      if (accepted) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME) { socket.destroy(); return; }
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      accepted = true;
      if (buffer.subarray(newline + 1).length) { socket.destroy(); return; }
      const run = (async () => {
        let request, response;
        try {
          request = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
          if (!object(request) || request.format !== FORMAT || typeof request.id !== 'string' || request.id.length > 100) throw failure('INVALID_REQUEST', '无效的本机请求');
          if (!authenticated(request.token, token)) throw failure('UNAUTHORIZED', '本机连接未通过认证');
          if (closing) throw failure('SERVICE_CLOSING', '本机服务正在关闭');
          if (typeof request.method !== 'string' || !Object.hasOwn(handlers, request.method)) throw failure('METHOD_NOT_FOUND', '此本机操作不受支持');
          response = { id: request.id, ok: true, result: await handlers[request.method](request.params ?? {}) };
        } catch (error) { response = { id: typeof request?.id === 'string' ? request.id : null, ok: false, error: wireError(error) }; }
        const serialized = JSON.stringify(response) + '\n';
        if (Buffer.byteLength(serialized) > MAX_FRAME) socket.end(JSON.stringify({ id: response.id, ok: false, error: { code: 'RESPONSE_TOO_LARGE', message: '本机响应过大' } }) + '\n');
        else if (!socket.destroyed) socket.end(serialized);
      })();
      pending.add(run); run.finally(() => pending.delete(run)).catch(() => socket.destroy());
    });
  });
  try {
    try { const stat = await fs.lstat(p.socketPath); assertPrivate(stat, '本机连接'); if (!stat.isSocket()) throw failure('UNSAFE_ENDPOINT', '本机连接路径不可用'); await fs.unlink(p.socketPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(p.socketPath, () => { server.removeListener('error', reject); resolve(); }); });
    await fs.chmod(p.socketPath, 0o600);
    await atomicJson(p.endpoint, { format: FORMAT, service, socketPath: p.socketPath, pid: process.pid, token, nonce });
  } catch (error) {
    server.close();
    await fs.rm(p.lock, { force: true });
    throw error;
  }
  let closePromise;
  return {
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
      const closed = new Promise(resolve => server.close(resolve));
      await Promise.allSettled([...pending]);
      for (const socket of connections) socket.destroy();
      await closed;
      try { const current = await readPrivateJson(p.endpoint); if (current.nonce === nonce) await fs.unlink(p.endpoint); } catch {}
      await fs.rm(p.socketPath, { force: true });
      try { const current = await readPrivateJson(p.lock); if (current.nonce === nonce) await fs.unlink(p.lock); } catch {}
      })();
      return closePromise;
    },
  };
}

async function callPrivate({ directory, service, method, params = {}, timeoutMs = 12000 }) {
  const p = paths(directory, service);
  const dirStat = await fs.lstat(p.directory).catch(() => { throw failure('SERVICE_UNAVAILABLE', '本机服务尚未启动'); });
  assertPrivate(dirStat, '本机桥接目录');
  let endpoint;
  try { endpoint = await readPrivateJson(p.endpoint); }
  catch (error) { if (error.code === 'ENOENT') throw failure('SERVICE_UNAVAILABLE', '本机服务尚未启动'); throw error; }
  if (!object(endpoint) || endpoint.format !== FORMAT || endpoint.service !== service || endpoint.socketPath !== p.socketPath || !/^[0-9a-f]{64}$/.test(endpoint.token)) throw failure('UNSAFE_ENDPOINT', '本机连接信息无效');
  const socketDirectory = await fs.lstat(p.socketDirectory); assertPrivate(socketDirectory, '本机连接目录');
  const socketStat = await fs.lstat(p.socketPath).catch(() => { throw failure('SERVICE_UNAVAILABLE', '本机服务已断开'); });
  assertPrivate(socketStat, '本机连接');
  if (!socketStat.isSocket()) throw failure('UNSAFE_ENDPOINT', '本机连接不是 Unix socket');
  const id = crypto.randomUUID();
  const frame = JSON.stringify({ format: FORMAT, id, token: endpoint.token, method, params }) + '\n';
  if (Buffer.byteLength(frame) > MAX_FRAME) throw failure('REQUEST_TOO_LARGE', '留存内容超过本机传输限制');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(p.socketPath);
    let buffer = Buffer.alloc(0), done = false;
    const finish = (error, value) => { if (done) return; done = true; socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setTimeout(timeoutMs, () => finish(failure('TIMEOUT', '本机请求等待超时，请重试')));
    socket.on('connect', () => socket.write(frame));
    socket.on('error', () => finish(failure('SERVICE_UNAVAILABLE', '本机服务已断开')));
    socket.on('end', () => { if (!done) finish(failure('CONNECTION_CLOSED', '本机连接未返回完整结果')); });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME) return finish(failure('RESPONSE_TOO_LARGE', '本机响应过大'));
      const newline = buffer.indexOf(10); if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
        if (!object(response) || response.id !== id || typeof response.ok !== 'boolean') throw failure('INVALID_RESPONSE', '本机响应无效');
        if (!response.ok) throw failure(response.error?.code || 'REQUEST_FAILED', response.error?.message || '本机请求未完成');
        finish(null, response.result);
      } catch (error) { finish(error); }
    });
  });
}

module.exports = { startPrivateServer, callPrivate, MAX_FRAME };
