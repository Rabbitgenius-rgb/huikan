/* Outline icons from Tabler Icons (MIT, see THIRD_PARTY_NOTICES.md), built as DOM nodes so no markup is parsed. */
(() => {
  const paths = {
    message: ['M8 9h8', 'M8 13h6', 'M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12'],
    list: ['M13 5h8', 'M13 9h5', 'M13 15h8', 'M13 19h5', 'M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4', 'M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4'],
    focus: ['M11.5 12a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0', 'M5 12a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M12 3l0 2', 'M3 12l2 0', 'M12 19l0 2', 'M19 12l2 0'],
    wave: ['M21 12h-2c-.894 0 -1.662 -.857 -1.761 -2c-.296 -3.45 -.749 -6 -2.749 -6s-2.5 3.582 -2.5 8s-.5 8 -2.5 8s-2.452 -2.547 -2.749 -6c-.1 -1.147 -.867 -2 -1.763 -2h-2'],
    gauge: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M13.41 10.59l2.59 -2.59', 'M7 12a5 5 0 0 1 5 -5'],
    bulb: ['M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7', 'M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3', 'M9.7 17l4.6 0'],
    doc: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2', 'M9 9l1 0', 'M9 13l6 0', 'M9 17l6 0'],
    code: ['M7 8l-4 4l4 4', 'M17 8l4 4l-4 4', 'M14 4l-4 16'],
    sparkles: ['M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6'],
    folder: ['M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2'],
    book: ['M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0', 'M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0', 'M3 6l0 13', 'M12 6l0 13', 'M21 6l0 13'],
    target: ['M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0', 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0'],
    check: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M9 12l2 2l4 -4'],
    leaf: ['M5 21c.5 -4.5 2.5 -8 7 -10', 'M9 18c6.218 0 10.5 -3.288 11 -12v-2h-4.014c-9 0 -11.986 4 -12 9c0 1 0 3 2 5h3l.014 0'],
    help: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 16v.01', 'M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483'],
    inbox: ['M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12', 'M4 13h3l3 3h4l3 -3h3'],
    close: ['M18 6l-12 12', 'M6 6l12 12'],
    back: ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'],
    note: ['M13 20l7 -7', 'M13 20v-6a1 1 0 0 1 1 -1h6v-7a2 2 0 0 0 -2 -2h-12a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7'],
    refresh: ['M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4', 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4'],
  };
  // Topic symbols are SF Symbol names chosen by the topic model; older caches used a few more.
  const topicSymbols = {
    'text.bubble': 'message', 'list.bullet.indent': 'list', viewfinder: 'focus', 'waveform.path': 'wave', speedometer: 'gauge',
    lightbulb: 'bulb', 'lightbulb.fill': 'bulb', 'doc.text': 'doc', 'chevron.left.forwardslash.chevron.right': 'code',
    sparkles: 'sparkles', folder: 'folder', 'folder.fill': 'folder', book: 'book', 'book.closed': 'book', target: 'target',
    'checkmark.circle': 'check', leaf: 'leaf', 'questionmark.circle': 'help', tray: 'inbox',
  };
  const NS = 'http://www.w3.org/2000/svg';
  function icon(name, size = 16) {
    const svg = document.createElementNS(NS, 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, String(value));
    for (const d of paths[name] || paths.doc) { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.append(path); }
    return svg;
  }
  const topicIcon = (symbol, size) => icon(topicSymbols[symbol] || 'doc', size);
  window.RecallIcons = Object.freeze({ icon, topicIcon });
})();
