const test = require('node:test'), assert = require('node:assert/strict');
const { panelPosition } = require('../companion/src/panel-position.cjs');
test('bottom Windows taskbar opens the complete panel above the tray', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const result = panelPosition({ x: 1860, y: 1040, width: 24, height: 40 }, area, 320, 400);
  assert.deepEqual(result, { x: 1592, y: 632 });
  assert.ok(result.y + 400 <= area.y + area.height);
});
test('macOS top tray remains below the menu bar and inside its monitor', () => {
  assert.deepEqual(panelPosition({ x: 900, y: 0, width: 24, height: 24 }, { x: 0, y: 24, width: 1440, height: 876 }, 320, 400), { x: 752, y: 32 });
});
test('side taskbar on a negative-coordinate monitor keeps the panel on screen', () => {
  const area = { x: -1840, y: -500, width: 1840, height: 1080 };
  const result = panelPosition({ x: -1920, y: 540, width: 80, height: 40 }, area, 320, 400);
  assert.deepEqual(result, { x: -1832, y: 134 });
});
