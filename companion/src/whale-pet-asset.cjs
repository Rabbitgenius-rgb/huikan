'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const pending = new Map();
// One immutable bundled asset, read once for all notes. A data URL keeps the
// renderer's alpha hit testing origin-safe without weakening web security.
function load(file) {
  if (!pending.has(file)) pending.set(file, fs.readFile(path.join(__dirname, 'note/assets', file)).then(bytes => {
    if (bytes.length > 8 * 1024 * 1024 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
    return 'data:image/png;base64,' + bytes.toString('base64');
  }).catch(() => null));
  return pending.get(file);
}
const loadWhalePetAsset = () => load('whale-girl-sheet.png');
const loadWhalePetMotionAsset = () => load('whale-girl-motions-v2.png');
const VIDEO_NAMES = ['idle', 'greet', 'wink', 'curious', 'stretch', 'yawn', 'nap', 'surprise', 'celebrate', 'heart', 'showNote', 'swim', 'read', 'held', 'landing'];
let videos, bagVideos;
async function video(file) {
  try {
    const bytes = await fs.readFile(file);
    if (bytes.length > 8 * 1024 * 1024 || bytes.toString('hex', 0, 4) !== '1a45dfa3') return null;
    return 'data:video/webm;base64,' + bytes.toString('base64');
  } catch { return null; }
}
function loadWhalePetVideos() {
  // Optional, bundled files only. Missing/corrupt clips retain the matching poses.
  if (!videos) videos = Promise.all(VIDEO_NAMES.map(async name => {
    const clip = await video(path.join(__dirname, 'note/assets/videos', name + '.webm'));
    return clip ? [name,clip] : null;
  })).then(entries => Object.fromEntries(entries.filter(Boolean)));
  return videos;
}
function loadBagPetVideos() {
  if (!bagVideos) {
    const media = path.join(__dirname,'bag/media');
    bagVideos = Promise.all([...VIDEO_NAMES,'blink'].map(async name => {
      const file = name === 'idle' ? path.join(media,'idle-clean.webm') : path.join(media,'gestures',name + '.webm');
      const clip = await video(file);
      return clip ? [name,clip] : null;
    })).then(entries => Object.fromEntries(entries.filter(Boolean)));
  }
  return bagVideos;
}
module.exports = { loadWhalePetAsset, loadWhalePetMotionAsset, loadWhalePetVideos, loadBagPetVideos };
