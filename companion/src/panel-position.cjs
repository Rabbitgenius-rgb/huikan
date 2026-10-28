'use strict';
// Keep the panel inside the monitor's usable area, including bottom/side taskbars.
function panelPosition(tray, area, width, height) {
  const margin = 8;
  const clamp = (value, start, length, size) => Math.max(start + margin, Math.min(value, start + length - size - margin));
  const below = tray.y + tray.height + 6;
  const preferredY = below + height <= area.y + area.height - margin ? below : tray.y - height - 6;
  return {
    x: Math.round(clamp(tray.x + tray.width / 2 - width / 2, area.x, area.width, width)),
    y: Math.round(clamp(preferredY, area.y, area.height, height)),
  };
}
module.exports = { panelPosition };
