'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SHORTCUTS = Object.freeze([
  Object.freeze({ accelerator: 'Control+Shift+K', label: 'Ctrl+Shift+K' }),
  Object.freeze({ accelerator: 'Control+Alt+K', label: 'Ctrl+Alt+K' }),
  Object.freeze({ accelerator: 'Control+Shift+Space', label: 'Ctrl+Shift+Space' }),
]);
const DEFAULT_SHORTCUT = SHORTCUTS[0].accelerator;

function createRecallShortcut({ directory, globalShortcut, invoke }) {
  const file = path.join(directory, 'recall-shortcut-v1.json');
  let selected = DEFAULT_SHORTCUT, active = null, issue = '', closed = false, tail = Promise.resolve();
  const status = () => ({ accelerator: selected, registered: active === selected, label: SHORTCUTS.find(value => value.accelerator === selected).label, error: issue });
  const serial = action => {
    const task = tail.catch(() => {}).then(() => {
      if (closed) throw Error('回看正在退出，快捷键未更改。');
      return action();
    });
    tail = task; return task;
  };
  const register = accelerator => {
    try { return globalShortcut.register(accelerator, invoke) === true; }
    catch { return false; }
  };
  return {
    choices: SHORTCUTS,
    status,
    start() {
      return serial(async () => {
        try {
          const saved = JSON.parse(await fs.readFile(file, 'utf8'));
          if (saved?.version !== 1 || !SHORTCUTS.some(value => value.accelerator === saved.accelerator)) throw Error('Invalid saved shortcut');
          selected = saved.accelerator;
        } catch (error) {
          if (error.code !== 'ENOENT') issue = '快捷键设置未能读取，已尝试默认组合。';
        }
        if (active === selected || register(selected)) active = selected;
        else issue = '这个快捷键已被其他程序占用。请右键托盘图标，在“唤出快捷键”中选择其他组合。';
        return status();
      });
    },
    select(accelerator) {
      return serial(async () => {
        if (!SHORTCUTS.some(value => value.accelerator === accelerator)) throw Error('不支持的快捷键组合。');
        if (accelerator === active) { issue = ''; return status(); }
        if (!register(accelerator)) {
          issue = `这个快捷键已被其他程序占用。${active ? '原有快捷键已保留。' : '尚未启用全局快捷键。'}请选择其他组合。`;
          return status();
        }
        const temporary = `${file}.${crypto.randomUUID()}.tmp`;
        try {
          await fs.mkdir(directory, { recursive: true, mode: 0o700 });
          await fs.writeFile(temporary, JSON.stringify({ version: 1, accelerator }) + '\n', { flag: 'wx', mode: 0o600 });
          await fs.rename(temporary, file);
        } catch {
          globalShortcut.unregister(accelerator);
          issue = `快捷键设置未能保存。${active ? '原有快捷键已保留。' : '尚未启用全局快捷键。'}请检查资料目录后重试。`;
          return status();
        } finally {
          await fs.rm(temporary, { force: true }).catch(() => {});
        }
        if (active) globalShortcut.unregister(active);
        active = selected = accelerator; issue = '';
        return status();
      });
    },
    async close() {
      closed = true; await tail.catch(() => {});
      if (active) globalShortcut.unregister(active);
      active = null;
    },
  };
}

module.exports = { createRecallShortcut, SHORTCUTS, DEFAULT_SHORTCUT };
