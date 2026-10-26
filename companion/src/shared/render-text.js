/* Safe display only: the original text remains unchanged in the library. */
(() => {
  const validUrl = value => {
    try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
  };
  function appendLinks(host, text, openLink) {
    const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"']+/g;
    let from = 0;
    for (const match of text.matchAll(pattern)) {
      host.append(document.createTextNode(text.slice(from, match.index)));
      const raw = match[2] || match[0];
      const suffix = match[2] ? '' : (raw.match(/[.,;!?，。；！？）]+$/)?.[0] || '');
      const href = validUrl(suffix ? raw.slice(0, -suffix.length) : raw);
      if (href) {
        const a = document.createElement('a'); a.textContent = match[1] || (suffix ? raw.slice(0, -suffix.length) : raw); a.href = href; a.rel = 'noopener noreferrer';
        a.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (openLink) openLink(href); }); host.append(a);
        if (suffix) host.append(document.createTextNode(suffix));
      } else host.append(document.createTextNode(match[0]));
      from = match.index + match[0].length;
    }
    host.append(document.createTextNode(text.slice(from)));
  }
  function render(host, text, openLink) {
    host.replaceChildren();
    const lines = String(text ?? '').split('\n');
    let block = [], code = false;
    const flush = () => {
      if (!block.length) return;
      const el = document.createElement(code ? 'pre' : 'div'); el.className = code ? 'recall-code' : 'recall-paragraph';
      if (code) el.textContent = block.join('\n'); else appendLinks(el, block.join('\n'), openLink);
      host.append(el); block = [];
    };
    for (const line of lines) {
      if (/^\s*```/.test(line)) { flush(); code = !code; }
      else block.push(line);
    }
    flush();
  }
  window.RecallText = Object.freeze({ render, validUrl });
})();
