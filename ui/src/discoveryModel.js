// Pure data helpers. This module never reads files, a Vault, storage, or a network.
import {normalizeDocumentIndex} from './sublime/documentIndex.js';
const text = value => typeof value === 'string' ? value : '';
const scalar = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const key = value => text(value).trim();
const validKey = value => Boolean(key(value)) && !/[\u0000-\u001f\u007f]/.test(value);
const unique = values => [...new Set(values)];

export function emptyDiscoveryState() { return {schema: 1, collections: [], boards: []}; }

export function normalizeDiscoveryState(value) {
  if (!isObject(value)) return emptyDiscoveryState();
  const schema = value.schema ?? value.schemaVersion ?? value.version ?? 1;
  if (schema !== 1) throw new Error('不支持这份合集数据的版本，请保留原数据。');
  const collectionIds = new Set();
  const collections = (Array.isArray(value.collections) ? value.collections : []).flatMap(collection => {
    if (!isObject(collection) || !validKey(collection.id) || collectionIds.has(key(collection.id))) return [];
    const id = key(collection.id); collectionIds.add(id);
    return [{id, title: key(collection.title) || '未命名合集', itemPaths: unique((Array.isArray(collection.itemPaths) ? collection.itemPaths : []).filter(validKey).map(key))}];
  });
  const boardIds = new Set();
  const boards = (Array.isArray(value.boards) ? value.boards : []).flatMap(board => {
    if (!isObject(board) || !validKey(board.id) || boardIds.has(key(board.id))) return [];
    const id = key(board.id); boardIds.add(id);
    const nodeIds = new Set();
    const nodes = (Array.isArray(board.nodes) ? board.nodes : []).flatMap(node => {
      if (!isObject(node) || !validKey(node.id) || !validKey(node.itemPath) || nodeIds.has(key(node.id))) return [];
      const nodeId = key(node.id); nodeIds.add(nodeId);
      return [{id: nodeId, itemPath: key(node.itemPath), x: Number.isFinite(node.x) ? node.x : 0, y: Number.isFinite(node.y) ? node.y : 0}];
    });
    const edgeIds = new Set(), pairs = new Set();
    const edges = (Array.isArray(board.edges) ? board.edges : []).flatMap(edge => {
      if (!isObject(edge) || !validKey(edge.id) || edgeIds.has(key(edge.id))) return [];
      const from = key(edge.from ?? edge.source), to = key(edge.to ?? edge.target);
      const pair = JSON.stringify([from, to].sort());
      if (from === to || !nodeIds.has(from) || !nodeIds.has(to) || pairs.has(pair)) return [];
      edgeIds.add(key(edge.id)); pairs.add(pair);
      return [{id: key(edge.id), from, to, ...(typeof edge.label === 'string' ? {label: edge.label} : {})}];
    });
    return [{id, title: key(board.title) || '未命名画板', collectionId: collectionIds.has(key(board.collectionId)) ? key(board.collectionId) : '', nodes, edges}];
  });
  return {schema: 1, collections, boards};
}

export function validateDiscoveryState(value) {
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  if (!isObject(value)) return {ok: false, errors: ['state: 应为对象'], state: emptyDiscoveryState()};
  const schema = value.schema ?? value.schemaVersion ?? value.version ?? 1;
  if (schema !== 1) return {ok: false, errors: ['schema: 不支持的版本'], state: null};
  if (!Array.isArray(value.collections)) fail('collections', '应为数组');
  if (!Array.isArray(value.boards)) fail('boards', '应为数组');
  const collectionIds = new Set(), boardIds = new Set();
  for (const [index, collection] of (Array.isArray(value.collections) ? value.collections : []).entries()) {
    const where = `collections[${index}]`;
    if (!isObject(collection)) { fail(where, '应为对象'); continue; }
    if (!validKey(collection.id) || collectionIds.has(key(collection.id))) fail(`${where}.id`, '标识不能为空或重复');
    collectionIds.add(key(collection.id));
    if (!key(collection.title)) fail(`${where}.title`, '标题不能为空');
    if (!Array.isArray(collection.itemPaths)) fail(`${where}.itemPaths`, '应为数组');
    else if (collection.itemPaths.some(path => !validKey(path)) || unique(collection.itemPaths.map(key)).length !== collection.itemPaths.length) fail(`${where}.itemPaths`, '路径不能为空或重复');
  }
  for (const [index, board] of (Array.isArray(value.boards) ? value.boards : []).entries()) {
    const where = `boards[${index}]`;
    if (!isObject(board)) { fail(where, '应为对象'); continue; }
    if (!validKey(board.id) || boardIds.has(key(board.id))) fail(`${where}.id`, '标识不能为空或重复');
    boardIds.add(key(board.id));
    if (!key(board.title)) fail(`${where}.title`, '标题不能为空');
    if (board.collectionId !== undefined && typeof board.collectionId !== 'string') fail(`${where}.collectionId`, '应为合集标识文字');
    else if (key(board.collectionId) && !collectionIds.has(key(board.collectionId))) fail(`${where}.collectionId`, '关联合集不存在');
    if (!Array.isArray(board.nodes)) fail(`${where}.nodes`, '应为数组');
    if (!Array.isArray(board.edges)) fail(`${where}.edges`, '应为数组');
    const nodeIds = new Set(), edgeIds = new Set(), pairs = new Set();
    for (const [nodeIndex, node] of (Array.isArray(board.nodes) ? board.nodes : []).entries()) {
      const nodeWhere = `${where}.nodes[${nodeIndex}]`;
      if (!isObject(node)) { fail(nodeWhere, '应为对象'); continue; }
      if (!validKey(node.id) || nodeIds.has(key(node.id))) fail(`${nodeWhere}.id`, '节点标识不能为空或重复');
      nodeIds.add(key(node.id));
      if (!validKey(node.itemPath)) fail(`${nodeWhere}.itemPath`, '内容路径不能为空');
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) fail(nodeWhere, '坐标必须是有限数值');
    }
    for (const [edgeIndex, edge] of (Array.isArray(board.edges) ? board.edges : []).entries()) {
      const edgeWhere = `${where}.edges[${edgeIndex}]`;
      if (!isObject(edge)) { fail(edgeWhere, '应为对象'); continue; }
      if (!validKey(edge.id) || edgeIds.has(key(edge.id))) fail(`${edgeWhere}.id`, '连线标识不能为空或重复');
      edgeIds.add(key(edge.id));
      const from = key(edge.from ?? edge.source), to = key(edge.to ?? edge.target);
      const pair = JSON.stringify([from, to].sort());
      if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) fail(edgeWhere, '连线必须连接两个现有的不同节点');
      if (pairs.has(pair)) fail(edgeWhere, '两个节点之间的连线重复');
      pairs.add(pair);
      if (edge.label !== undefined && typeof edge.label !== 'string') fail(`${edgeWhere}.label`, '应为文字');
    }
  }
  return {ok: errors.length === 0, errors, state: normalizeDiscoveryState(value)};
}

// RFC 4180 quoting: newlines and spaces inside quoted cells remain untouched.
export function parseCsv(value) {
  const input = text(value).replace(/^\ufeff/, '');
  const rows = []; let row = [], field = '', quoted = false, afterQuote = false, started = false;
  const finishRow = () => { row.push(field); if (started || row.some(cell => cell !== '')) rows.push(row); row = []; field = ''; started = false; afterQuote = false; };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
      continue;
    }
    if (char === ',') { row.push(field); field = ''; started = true; afterQuote = false; continue; }
    if (char === '\n' || char === '\r') { if (char === '\r' && input[index + 1] === '\n') index += 1; finishRow(); continue; }
    if (afterQuote) throw new Error('CSV 引号结束后只能跟逗号或换行。');
    if (char === '"') { if (field !== '') throw new Error('CSV 单元格中的引号需要使用双引号转义。'); quoted = true; started = true; }
    else { field += char; started = true; }
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号。');
  if (started || row.length || field) finishRow();
  return rows;
}

const pick = (record, names) => { for (const name of names) if (typeof record?.[name] === 'string' || typeof record?.[name] === 'number') return scalar(record[name]); return ''; };
const pickNonEmpty = (record, names) => { for (const name of names) { const value = pick(record, [name]); if (value.trim()) return value; } return ''; };
export function safeImportUrl(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (!/^https?:\/\//i.test(candidate) || /[\\\x00-\x20\x7f]/.test(candidate)) return '';
  try { const parsed = new URL(candidate); return parsed.hostname && !parsed.username && !parsed.password ? candidate : ''; } catch { return ''; }
}
function importTags(value) {
  if (typeof value === 'string') {
    try { const parsed=JSON.parse(value); value=Array.isArray(parsed)?parsed:value.split(/[,;|]/); } catch { value=value.split(/[,;|]/); }
  }
  return unique((Array.isArray(value)?value:[]).map(tag=>typeof tag==='string'?tag:pick(tag,['name'])).filter(Boolean));
}
function importRecord(record, inherited = {}) {
  if (!isObject(record)) return null;
  const data = {...inherited, ...(isObject(record.fields) ? record.fields : {}), ...record};
  const body = pick(data, ['Highlight', 'highlight', 'body', 'full_text', 'tweet_text', 'text', 'content']);
  const sourceUrl = ['URL', 'url', 'sourceUrl', 'source_url', 'tweet_url', 'href', 'link', 'source'].map(name => safeImportUrl(pick(data, [name]))).find(Boolean) || '';
  const caption = pick(data, ['Note', 'note', 'caption', 'description']);
  const ocrText = pick(data, ['ocrText', 'localOcrText', 'local_ocr_text']);
  let documentIndex=data.documentIndex;
  if(typeof documentIndex==='string'){try{documentIndex=documentIndex.trim()?JSON.parse(documentIndex):null;}catch{throw Error('文档分页字段应为完整 JSON。');}}
  documentIndex=normalizeDocumentIndex(documentIndex);
  if (!body.trim() && !sourceUrl && !caption.trim() && !ocrText.trim()) return null;
  const sourceTitleNames = ['Book Title', 'book_title', 'bookTitle', 'sourceTitle', 'source_title'];
  const hasSourceTitle = sourceTitleNames.some(name => typeof data[name] === 'string' || typeof data[name] === 'number');
  const sourceTitle = pickNonEmpty(data, sourceTitleNames) || (!hasSourceTitle && body.trim() ? pick(data, ['title']) : '');
  const explicitPage = pickNonEmpty(data, ['Page', 'page', 'source_page', 'highlight_page']);
  const sourceLocation = pickNonEmpty(data, ['sourceLocation', 'source_location', 'Location', 'location', 'location_value']);
  const rawType = pick(data, ['type', 'kind']).toLowerCase();
  const isHighlight = ['Highlight', 'highlight'].some(name => Object.hasOwn(data, name)) || Boolean(sourceTitle && (explicitPage || sourceLocation));
  const social = sourceUrl && /(?:^|\.)(?:instagram\.com|x\.com|twitter\.com)$/i.test(new URL(sourceUrl).hostname);
  const result = {
    title: pickNonEmpty(data, ['title', 'Title', 'name']) || sourceTitle || body.trim().split(/\r?\n/)[0].slice(0, 80) || sourceUrl,
    body,
    sourceUrl,
    author: pickNonEmpty(data, ['Author', 'author', 'username']),
    page: explicitPage,
    sourceLocation, sourceTitle,
    caption,
    date: pick(data, ['Date', 'date', 'highlighted_at', 'created_at', 'createdAt']),
    type: rawType || (isHighlight ? 'highlight' : social ? 'social' : body.trim() ? sourceUrl ? 'article' : 'text' : sourceUrl ? 'link' : 'text'),
    ocrText,
    ...(documentIndex?{documentIndex}:{}),
    tags:importTags(data.tags),
  };
  return {...result, fingerprint: importFingerprint(result)};
}

// Date and personal Note do not change an ordinary highlight/link identity.
// Bodyless, URL-less exports use their only textual payload instead of all colliding.
export function importFingerprint(record) {
  const fields = isObject(record.fields) ? record.fields : {};
  const pageValue = fields.source_page ?? record.page;
  const page = Number(pageValue) === 0 && scalar(pageValue).trim() ? '' : scalar(pageValue).trim();
  const location = (text(record.sourceLocation) || text(fields.source_location)).trim();
  const sourceTitle = text(record.sourceTitle) || text(fields.source_title);
  const author = text(record.author) || text(fields.author);
  const sourceUrl = text(record.sourceUrl) || text(record.url) || text(fields.source_url) || text(fields.url);
  // A single legacy Location used to occupy page. Keep that identity stable; when
  // both a physical page and a different location exist, include both to avoid loss.
  const identityLocation = location && page && location !== page ? JSON.stringify([page, location]) : location || page;
  const identity = [text(record.body), sourceTitle.trim(), author.trim(), identityLocation, sourceUrl.trim()];
  if (!text(record.body).trim() && !sourceUrl.trim()) {
    const caption = text(record.caption) || text(fields.caption);
    const ocrText = text(record.ocrText) || text(record.localOcrText) || text(record.localOCR?.text) || text(fields.local_ocr_text);
    if (caption.trim() || ocrText.trim()) identity.push(['text-only-v1', caption, ocrText]);
  }
  const canonical = JSON.stringify(identity);
  let hash = 14695981039346656037n;
  for (let index = 0; index < canonical.length; index += 1) { hash ^= BigInt(canonical.charCodeAt(index)); hash = BigInt.asUintN(64, hash * 1099511628211n); }
  return `highlight-v1:${hash.toString(16).padStart(16, '0')}`;
}

function parseReadwiseCsv(input) {
  const [headers, ...rows] = parseCsv(input);
  if (!headers) return [];
  const names = headers.map(header => header.trim());
  const aliases = {'book title': 'Book Title', author: 'Author', highlight: 'Highlight', note: 'Note', location: 'Location', date: 'Date', url: 'URL', link:'URL', title: 'Title', name:'Title', body: 'body', caption: 'caption', description:'description', page: 'page', 'source title': 'sourceTitle', 'source url':'sourceUrl', 'source location':'sourceLocation', 'local ocr': 'ocrText', 'document index':'documentIndex', type:'type', tags:'tags'};
  const keys = names.map(name => aliases[name.toLowerCase()] || name);
  if (!keys.some(name => ['Highlight', 'body', 'URL', 'sourceUrl'].includes(name))) throw new Error('CSV 需要 Highlight、body 或 URL 列。');
  return rows.flatMap((row, index) => {
    if (row.length > keys.length) throw new Error(`CSV 第 ${index + 2} 行的字段数量超过表头。`);
    const record = Object.fromEntries(keys.map((name, position) => [name, row[position] ?? '']));
    const parsed = importRecord(record); return parsed ? [parsed] : [];
  });
}

const timestampDate = value => { const seconds = Number(value); return Number.isFinite(seconds) && seconds >= 0 && seconds < 253402300800 ? new Date(seconds * 1000).toISOString() : ''; };
function parseImportJson(value, inherited = {}, depth = 0) {
  if (depth > 32) throw new Error('JSON 导入嵌套过深。');
  if (Array.isArray(value)) return value.flatMap(record => parseImportJson(record, inherited, depth + 1));
  if (typeof value === 'string') { const parsed=importRecord({sourceUrl:value,body:''});if(parsed)return [parsed]; }
  if (!isObject(value)) throw new Error('JSON 导入需要记录数组或包含 items/highlights/books 的对象。');
  if (isObject(value.tweet) || Object.hasOwn(value,'full_text') && /^\d+$/.test(pick(value,['id_str','id']))) {
    const tweet = value.tweet || value, tweetId = pick(tweet, ['id_str', 'id']);
    const parsed = importRecord({...tweet, sourceUrl:/^\d+$/.test(tweetId) ? `https://x.com/i/web/status/${tweetId}` : '', sourceTitle:'X', type:'social'});
    return parsed ? [parsed] : [];
  }
  if (isObject(value.string_map_data)) {
    const authorEntry = Object.entries(value.string_map_data).find(([name])=>/^(?:media owner|author|username|account)$/i.test(name))?.[1];
    return Object.values(value.string_map_data).flatMap(entry => {
      if (!isObject(entry)) return [];
      const parsed = importRecord({title:pick(value, ['title']) || pick(entry, ['value']), author:pick(authorEntry,['value']) || pick(value,['author','username']), sourceUrl:pick(entry, ['href']), date:timestampDate(entry.timestamp), sourceTitle:'Instagram', type:'social'});
      return parsed ? [parsed] : [];
    });
  }
  if (Array.isArray(value.string_list_data)) return value.string_list_data.flatMap(entry => {
    const parsed = importRecord({title:pick(value, ['title']) || pick(entry, ['value']), sourceUrl:pick(entry, ['href']), date:timestampDate(entry?.timestamp), sourceTitle:'Instagram', type:'social'});
    return parsed ? [parsed] : [];
  });
  for (const name of ['items', 'books', 'highlights', 'bookmarks', 'links', 'saved_saved_media', 'saved_media', 'saved_posts', 'tweets']) {
    if (Array.isArray(value[name])) {
      const parent = {...inherited, ...value}; delete parent.items; delete parent.books; delete parent.highlights;
      if (name === 'highlights') parent.sourceTitle = pick(value, ['sourceTitle', 'title', 'book_title']) || pick(inherited, ['sourceTitle']);
      return value[name].flatMap(record => parseImportJson(record, parent, depth + 1));
    }
  }
  const parsed = importRecord(value, inherited);
  if (!parsed) throw new Error('JSON 记录没有可导入的高亮或正文。');
  return [parsed];
}

function decodeHtml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    const named = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '};
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? all;
    const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  });
}
const htmlText = value => decodeHtml(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
function parseBookmarksHtml(input) {
  // Text parsing only: no DOM, script execution, image loading, or remote fetch.
  const html = input.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const records = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(value => [value[1].toLowerCase(), decodeHtml(value[2] ?? value[3] ?? value[4] ?? '')]));
    const sourceUrl = safeImportUrl(attrs.href); if (!sourceUrl) continue;
    const after = html.slice(match.index + match[0].length), description = /^\s*<dd\b[^>]*>([\s\S]*?)(?=<dt\b|<\/dl\b|$)/i.exec(after)?.[1] || '';
    const parsed = importRecord({title:htmlText(match[2]) || sourceUrl, sourceUrl, body:'', caption:htmlText(description), date:timestampDate(attrs.add_date), type:'link'});
    if (parsed) records.push(parsed);
  }
  return records;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) { try { return JSON.parse(trimmed); } catch { return trimmed; } }
  return trimmed.startsWith("'") && trimmed.endsWith("'") ? trimmed.slice(1, -1).replace(/''/g, "'") : trimmed;
}
function parseMarkdownContext(input) {
  if (!input.startsWith('# 选定资料 · AI 上下文\n')) return null;
  const records = [];
  const headers = /^## \d+\. ([^\n]*)\n\n- 来源：([^\n]*)\n- 原链接：([^\n]*)\n- 作者：([^\n]*)\n- 页码：([^\n]*)\n- 原位置：([^\n]*)(?:\n- 日期：([^\n]*))?(?:\n- 类型：([^\n]*))?(?:\n- 标签：([^\n]*))?\n\n/gm;
  let cursor = 0;
  while (true) {
    headers.lastIndex = cursor;
    const match = headers.exec(input); if (!match) break;
    let position = headers.lastIndex;
    const readBlock = (label,level=3) => {
      const prefix = `${'#'.repeat(level)} ${label}\n\n`;
      if (!input.startsWith(prefix, position)) throw new Error(`Markdown 资料块缺少${label}。`);
      position += prefix.length;
      const fence = /^(`{3,})text\n/.exec(input.slice(position));
      if (!fence) throw new Error('Markdown 资料正文需要完整的 text 围栏。');
      const start = position + fence[0].length;
      const close = input.indexOf(`\n${fence[1]}`, start);
      if (close < 0 || !['\n', undefined].includes(input[close + 1 + fence[1].length])) throw new Error('Markdown 资料围栏未闭合。');
      const content = input.slice(start, close);
      position = close + 1 + fence[1].length;
      while (input[position] === '\n') position++;
      return content;
    };
    const body = readBlock('正文'), caption = readBlock('配文'), ocrText = readBlock('本地 OCR');
    let documentIndex;
    if(input.startsWith('### 文档分页\n\n',position)){
      try{documentIndex=normalizeDocumentIndex(JSON.parse(readBlock('文档分页')));}catch{throw Error('Markdown 文档分页字段无效。');}
      for(const page of documentIndex?.pages||[])if(readBlock(`第 ${page.page} 页`,4)!==page.text)throw Error('Markdown 分页正文与结构化索引不一致。');
    }
    const decoded = match.slice(1).map(value => { if (value?.startsWith('"')) { try { return JSON.parse(value); } catch {} } return value || ''; });
    const parsed = importRecord({title:decoded[0], sourceTitle:decoded[1], sourceUrl:decoded[2], author:decoded[3], page:decoded[4], sourceLocation:decoded[5], date:decoded[6], type:decoded[7], tags:decoded[8], body, caption, ocrText,documentIndex});
    if (parsed) records.push(parsed);
    cursor = position;
  }
  if (!records.length && input.trim()) throw new Error('Markdown 资料导出中未找到完整卡片。');
  return records;
}
function parseMarkdown(input, filename) {
  const context = parseMarkdownContext(input); if (context) return context;
  let body = input, metadata = {};
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(input);
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = /^([\w -]+):\s*(.*)$/.exec(line); if (match) metadata[match[1].trim()] = unquote(match[2]);
    }
    body = input.slice(frontmatter[0].length);
  }
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  const title = text(metadata.title) || heading?.[1] || filename.replace(/\.[^.]+$/, '') || '导入文字';
  const parsed = importRecord({...metadata, title, body});
  return parsed ? [parsed] : [];
}

function parseKindle(input) {
  const blocks = input.replace(/^\ufeff/, '').split(/^={10,}[ \t]*(?:\r\n|\n|\r|$)/m);
  const records = [];
  for (let block of blocks) {
    if (!block.trim()) continue;
    block = block.replace(/^(?:\r\n|\n|\r)/, '');
    const firstBreak = /\r\n|\n|\r/.exec(block); if (!firstBreak) continue;
    const heading = block.slice(0, firstBreak.index);
    const rest = block.slice(firstBreak.index + firstBreak[0].length);
    const secondBreak = /\r\n|\n|\r/.exec(rest); if (!secondBreak) continue;
    const metadata = rest.slice(0, secondBreak.index);
    if (!/^\s*-/.test(metadata) || /bookmark|书签/i.test(metadata)) continue;
    const body = rest.slice(secondBreak.index + secondBreak[0].length).replace(/^(?:\r\n|\n|\r)/, '').replace(/(?:\r\n|\n|\r)$/, '');
    if (!body.trim()) continue;
    const authorMatch = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(heading);
    const sourceTitle = (authorMatch?.[1] || heading).trim(), author = authorMatch?.[2] || '';
    const page = /\bpage\s+([\d–—-]+)/i.exec(metadata)?.[1] || /第\s*([\d–—-]+)\s*页/.exec(metadata)?.[1] || '';
    const sourceLocation = /\bLocation\s+([\d–—-]+)/i.exec(metadata)?.[1] || /(?:位置|第)\s*([\d–—-]+)\s*(?:的)?(?:标注|划线|位置)/.exec(metadata)?.[1] || '';
    const date = /Added on\s+(.+)$/i.exec(metadata)?.[1] || /添加于\s*(.+)$/.exec(metadata)?.[1] || '';
    const isNote = /\bNote\b|笔记/i.test(metadata);
    const previous = records.at(-1);
    if (isNote && previous && previous.sourceTitle === sourceTitle && previous.author === author && previous.page === page && previous.sourceLocation === sourceLocation) { previous.caption = body; continue; }
    const parsed = importRecord({title: sourceTitle, sourceTitle, author, page, sourceLocation, date, body, type:'highlight', ...(isNote ? {caption: body} : {})});
    if (parsed) records.push(parsed);
  }
  if (!records.length && input.trim()) throw new Error('未识别到 Kindle 高亮。请使用 My Clippings.txt 原始导出。');
  return records;
}

export function parseImportText(value, format = 'auto', options = {}) {
  if (typeof value !== 'string') throw new TypeError('导入内容必须是文字。');
  if (!value.trim()) return [];
  let type = format.toLowerCase();
  const filename = text(options.filename);
  if (type === 'auto') {
    type = /\.html?$/i.test(filename) || /<!doctype\s+netscape-bookmark-file|<a\b[^>]*href\s*=/i.test(value) ? 'html'
      : /\.csv$/i.test(filename) ? 'csv' : /\.json$/i.test(filename) || /^[\s\ufeff]*[\[{]/.test(value) || /^\s*window\.YTD\.[\w]+\.part\d+\s*=/.test(value) ? 'json'
      : /my[ _-]?clippings|\.txt$/i.test(filename) && /^={10,}/m.test(value) || /^\s*-.*(?:Highlight|标注|划线).+$/m.test(value) ? 'kindle'
        : /(?:^|,)\s*"?(?:Book Title|Highlight|URL|sourceUrl)"?\s*(?:,|$)/i.test(value.split(/\r?\n/)[0]) ? 'csv'
          : value.trim().split(/\r?\n/).every(line => Boolean(safeImportUrl(line))) ? 'url' : 'markdown';
  }
  if (type === 'csv' || type === 'readwise') return parseReadwiseCsv(value);
  if (type === 'json') {
    let json = value.replace(/^\ufeff/, '').trim();
    if (json.startsWith('window.YTD.')) {
      const wrapper = /^window\.YTD\.[\w]+\.part\d+\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(json);
      if (!wrapper) throw new Error('未识别到安全的 X JSON 导出。');
      json = wrapper[1];
    }
    return parseImportJson(JSON.parse(json));
  }
  if (['html', 'htm', 'bookmarks'].includes(type)) return parseBookmarksHtml(value);
  if (['url', 'links'].includes(type)) return value.split(/\r?\n/).flatMap(line => { const sourceUrl = safeImportUrl(line); return sourceUrl ? [importRecord({sourceUrl, body:'', type:'link'})] : []; });
  if (type === 'kindle' || type === 'clippings' || type === 'txt') return parseKindle(value);
  if (type === 'markdown' || type === 'md') return parseMarkdown(value, filename);
  throw new Error(`不支持的导入格式：${format}`);
}

export function dedupeImports(records, existing = []) {
  // A captured note adds its title and source references to the Markdown body.
  // The explicit import identity takes precedence over recomputing that transformed body.
  const seen = new Set(existing.map(record => text(record.fields?.import_fingerprint) || text(record.importFingerprint) || text(record.fingerprint) || importFingerprint(record)));
  const items = []; let duplicates = 0;
  for (const record of records) {
    const fingerprint = importFingerprint(record);
    if (seen.has(fingerprint)) { duplicates += 1; continue; }
    seen.add(fingerprint); items.push({...record, fingerprint});
  }
  return {items, duplicates};
}

function publicBody(value) {
  let body = text(value).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/<!--\s*mengcang-relations:start\s*-->[\s\S]*?(?:<!--\s*mengcang-relations:end\s*-->|$)/g, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const hiddenHeadings = new Set(['整理说明', '梦藏已确认联系', '内部元数据', '内部管理元数据', '管理元数据']);
  let hiddenLevel = 0;
  body = (body.match(/[^\n]*\n|[^\n]+$/g) || []).filter(line => {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*(?:\r?\n)?$/.exec(line);
    if (heading && hiddenLevel && heading[1].length <= hiddenLevel) hiddenLevel = 0;
    if (heading && hiddenHeadings.has(heading[2])) hiddenLevel = heading[1].length;
    return !hiddenLevel;
  }).join('');
  return body;
}

export function publicDiscoveryItem(item) {
  const fields = isObject(item.fields) ? item.fields : {};
  const source = text(item.source);
  const sourceUrl = text(item.sourceUrl) || text(item.url) || text(fields.url) || text(fields.source_url) || (/^https?:\/\//i.test(source) ? source : '');
  const caption = Object.prototype.hasOwnProperty.call(fields, 'caption') ? text(fields.caption) : text(item.caption);
  const sourceLocation = text(item.sourceLocation) || text(fields.source_location);
  return {
    title: text(item.title), sourceTitle: text(item.sourceTitle) || text(fields.source_title) || text(fields.book_title) || (!sourceUrl ? source : ''),
    sourceUrl, author: text(item.author) || text(fields.author), page: scalar(fields.source_page ?? item.page ?? fields.highlight_page ?? fields.page), sourceLocation,
    body: publicBody(item.body), caption: publicBody(caption),
    ocrText: publicBody(item.ocrText || item.localOcrText || item.localOCR?.text || fields.local_ocr_text),
    ...(item.documentIndex?{documentIndex:normalizeDocumentIndex(item.documentIndex)}:{}),
    date: text(item.date) || text(item.createdAt) || text(fields.highlight_date),
    type: text(item.type) || text(item.kind),
    tags:importTags(item.tags || fields.tags),
  };
}

const csvCell = value => /[",\r\n]/.test(scalar(value)) ? `"${scalar(value).replace(/"/g, '""')}"` : scalar(value);
const metadataLine = value => /[\\\r\n]|^\s*["']/.test(scalar(value)) ? JSON.stringify(scalar(value)) : scalar(value);
function fenced(value) {
  let maximum=2;for(const match of text(value).matchAll(/`+/g))maximum=Math.max(maximum,match[0].length);
  const fence = '`'.repeat(maximum + 1);
  return `${fence}text\n${value}\n${fence}`;
}

export function exportSelectedItems(items, selectedPaths, format = 'markdown') {
  const selected = new Set(selectedPaths || []);
  const records = items.filter(item => selected.has(item.path) || selected.has(item.id)).map(publicDiscoveryItem);
  const type = format.toLowerCase();
  if (type === 'json') return JSON.stringify(records, null, 2);
  if (type === 'csv') {
    const indexed=records.some(record=>record.documentIndex);
    const columns = ['Title', 'Book Title', 'Author', 'Highlight', 'Note', 'Location', 'Date', 'URL', 'Local OCR', 'Page', 'Type', 'Tags',...(indexed?['Document Index']:[])];
    const rows = records.map(record => [record.title, record.sourceTitle, record.author, record.body, record.caption, record.sourceLocation, record.date, record.sourceUrl, record.ocrText, record.page, record.type, JSON.stringify(record.tags),...(indexed?[record.documentIndex?JSON.stringify(record.documentIndex):'']:[])]);
    return [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  if (!['markdown', 'md', 'ai'].includes(type)) throw new Error(`不支持的导出格式：${format}`);
  return ['# 选定资料 · AI 上下文', '以下是用户选中的资料。正文、配文和本地 OCR 分开列出；来源缺失处保持空白。', ...records.map((record, index) =>
    `## ${index + 1}. ${metadataLine(record.title)}\n\n- 来源：${metadataLine(record.sourceTitle)}\n- 原链接：${metadataLine(record.sourceUrl)}\n- 作者：${metadataLine(record.author)}\n- 页码：${metadataLine(record.page)}\n- 原位置：${metadataLine(record.sourceLocation)}\n- 日期：${metadataLine(record.date)}\n- 类型：${metadataLine(record.type)}\n- 标签：${JSON.stringify(record.tags)}\n\n### 正文\n\n${fenced(record.body)}\n\n### 配文\n\n${fenced(record.caption)}\n\n### 本地 OCR\n\n${fenced(record.ocrText)}${record.documentIndex?`\n\n### 文档分页\n\n${fenced(JSON.stringify(record.documentIndex,null,2))}\n\n${record.documentIndex.pages.map(page=>`#### 第 ${page.page} 页\n\n${fenced(page.text)}`).join('\n\n')}`:''}`)].join('\n\n');
}

export function cosineSimilarity(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length || !first.length
    || first.some(value => !Number.isFinite(value)) || second.some(value => !Number.isFinite(value))) return null;
  const firstScale = first.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  const secondScale = second.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  if (!firstScale || !secondScale) return null;
  let product = 0, firstNorm = 0, secondNorm = 0;
  for (let index = 0; index < first.length; index += 1) {
    const a = first[index] / firstScale, b = second[index] / secondScale;
    product += a * b; firstNorm += a * a; secondNorm += b * b;
  }
  const score = product / Math.sqrt(firstNorm * secondNorm);
  return Number.isFinite(score) ? Math.max(-1, Math.min(1, score)) : null;
}

export function searchDiscoveryItems(items, query = '', options = {}) {
  const needle = text(query).trim().toLocaleLowerCase();
  if (!needle) return items.map(item => ({item}));
  if (options.mode !== 'semantic') {
    const terms = needle.split(/\s+/);
    return items.filter(item => {
      const record = publicDiscoveryItem(item);
      const searchable = [...Object.values(record), ...(Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : [])].join(' ').toLocaleLowerCase();
      return terms.every(term => searchable.includes(term));
    }).map(item => ({item}));
  }
  const queryEmbedding = options.queryEmbedding;
  if (!key(queryEmbedding?.model) || !key(queryEmbedding?.language)) return [];
  const embeddings = options.embeddings || {};
  return items.flatMap(item => {
    const path = item.path || item.id;
    const embedding = embeddings instanceof Map ? embeddings.get(path) : embeddings[path];
    // Original text and local OCR keep separate vectors; either can match in its
    // own actual language/model space without replacing the source's content.
    const candidates = [embedding, ...(Array.isArray(embedding?.alternates) ? embedding.alternates : [])];
    const scores = candidates.flatMap(candidate => {
      if (candidate?.model !== queryEmbedding.model || candidate?.language !== queryEmbedding.language) return [];
      const score = cosineSimilarity(queryEmbedding.vector, candidate.vector);
      return score === null ? [] : [score];
    });
    return scores.length ? [{item, score: scores.reduce((maximum, score) => Math.max(maximum, score), -Infinity)}] : [];
  }).sort((first, second) => second.score - first.score);
}
