(() => {
  const excerpt = document.getElementById('excerpt');
  const make = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
  window.api.onPreview(({ request, item }) => {
    excerpt.replaceChildren();
    const header = make('header'); header.append(make('span', '回看原文'), make('span', `第 ${item.externalSource.turn} 轮`));
    const body = make('div'); body.className = 'preview-body';
    const text = item.text.length > 1800 ? item.text.slice(0, 1800) + '\n…' : item.text;
    window.RecallText.render(body, text);
    const footer = make('footer'); footer.append(make('span', item.due ? '● 待回看' : '已看过'), make('span', item.pinned ? '已贴为便签' : '点击回原文 · 拖出贴便签'));
    excerpt.append(header, make('h2', item.title), body, footer);
    window.api.previewReady(request, excerpt.getBoundingClientRect().height);
  });
})();
