'use strict';
const path = require('node:path');
const {execFile} = require('node:child_process');
const {MAC_SHORTCUTS} = require('./recall-shortcut.cjs');

function createMacShortcutProbe({executable, runFile = execFile}) {
  if (!path.isAbsolute(executable)) throw Error('快捷键检测程序路径无效。');
  return accelerator => new Promise((resolve, reject) => {
    if (!MAC_SHORTCUTS.some(choice => choice.accelerator === accelerator)) { resolve(false); return; }
    runFile(executable, [accelerator], {encoding: 'utf8', timeout: 2500, maxBuffer: 2048}, (error, output) => {
      if (error) { reject(Error('本机快捷键占用检测未能完成。')); return; }
      try {
        const value = JSON.parse(output);
        if (typeof value?.available !== 'boolean') throw Error();
        resolve(value.available);
      } catch { reject(Error('本机快捷键占用检测返回无效结果。')); }
    });
  });
}
module.exports = {createMacShortcutProbe};
