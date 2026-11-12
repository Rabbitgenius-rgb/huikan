'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
let pending;
// One immutable bundled asset, read once for all notes. A data URL keeps the
// renderer's alpha hit testing origin-safe without weakening web security.
function loadWhalePetAsset() {
  if (!pending) pending = fs.readFile(path.join(__dirname, 'note/assets/whale-girl-sheet.png')).then(bytes => {
    if (bytes.length > 8 * 1024 * 1024 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
    return 'data:image/png;base64,' + bytes.toString('base64');
  }).catch(() => null);
  return pending;
}
module.exports = { loadWhalePetAsset };
