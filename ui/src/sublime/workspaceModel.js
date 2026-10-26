// Pure workspace data. No storage, network, native bridge, or AI is invoked here.
import {exportSelectedItems, parseCsv, safeImportUrl} from '../discoveryModel.js';
import {normalizeDocumentIndex,chooseDocumentTextIndex} from './documentIndex.js';
import {mergeReaderBackupState} from '../reader/readerState.js';
import {normalizeRecallSource,normalizeRecallReceipt} from '../../../core/recall/contract.mjs';
export {normalizeDocumentIndex};

export const MAX_OCR_TEXT = 1000000;

const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = message => { throw new Error(`工作区数据无效：${message}。请保留原数据后重试。`); };
const text = (value, name, limit = 100000) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) fail(`${name}应为有效文字`);
  return value;
};
const id = (value, name = '标识') => {
  const result = text(value, name, 4096).trim();
  if (!result || /[\x00-\x1f\x7f]/.test(result) || forbiddenKeys.has(result)) fail(`${name}不能为空或包含保留字符`);
  return result;
};
const list = (value, name) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20000) fail(`${name}应为数组且不超过20000项`);
  return value;
};
const ids = (value, name) => [...new Set(list(value, name).map(item => id(item, name)))];
const bool = (value, name) => {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') fail(`${name}应为布尔值`);
  return value;
};
const keyed = (values, name, normalize) => {
  const seen = new Set();
  return list(values, name).map(value => {
    const result = normalize(value);
    if (seen.has(result.id)) fail(`${name}中的标识重复：${result.id}`);
    seen.add(result.id);
    return result;
  });
};

export function safeSourceUrl(value) {
  return safeImportUrl(value);
}

export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
export const MAX_WORKSPACE_BACKUP_BYTES = 256 * 1024 * 1024;
export const WORKSPACE_FILE_TYPES = Object.freeze([
  ['image/png',['.png'],'image'], ['image/jpeg',['.jpg','.jpeg'],'image'], ['image/gif',['.gif'],'image'], ['image/webp',['.webp'],'image'], ['image/avif',['.avif'],'image'], ['image/bmp',['.bmp'],'image'], ['image/tiff',['.tif','.tiff'],'image'],
  ['application/pdf',['.pdf'],'pdf'], ['application/epub+zip',['.epub'],'epub'], ['application/msword',['.doc'],'word'], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document',['.docx'],'word'],
  ['image/heic',['.heic'],'heic'], ['image/heif',['.heif'],'heic'],
  ['video/mp4',['.mp4'],'video'], ['video/quicktime',['.mov'],'video'], ['video/x-msvideo',['.avi'],'video'], ['video/ogg',['.ogv'],'video'],
  ['audio/mpeg',['.mp3'],'audio'], ['audio/wav',['.wav'],'audio'], ['audio/x-wav',[],'audio'], ['audio/mp4',['.m4a','.m4b'],'audio'], ['audio/aac',['.aac'],'audio'], ['audio/flac',['.flac'],'audio'], ['audio/ogg',['.ogg','.opus'],'audio'], ['application/ogg',[],'audio'],
  ['image/jpg',[],'image'], ['image/pjpeg',[],'image'], ['audio/wave',[],'audio'], ['audio/vnd.wave',[],'audio'], ['audio/x-flac',[],'audio'], ['audio/x-m4a',[],'audio'], ['video/avi',[],'video'], ['video/msvideo',[],'video'], ['application/vnd.msword',[],'word'],
].map(([mime, extensions, kind]) => Object.freeze({mime, extensions:Object.freeze(extensions), kind})));
const rasterMime = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/tiff']);
const supportedMime = new Set(WORKSPACE_FILE_TYPES.map(value => value.mime));
const canonicalMime = mime => ({'image/jpg':'image/jpeg','image/pjpeg':'image/jpeg','audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/vnd.wave':'audio/wav','audio/x-flac':'audio/flac','audio/x-m4a':'audio/mp4','video/avi':'video/x-msvideo','video/msvideo':'video/x-msvideo','application/vnd.msword':'application/msword','application/ogg':'audio/ogg','video/ogg':'audio/ogg'})[mime] || mime;
const readLittle = (value, offset, length) => { let result = 0; for (let i = length - 1; i >= 0; i--) result = result * 256 + value.charCodeAt(offset + i); return result; };
function base64Bytes(base64, start, end) {
  const first = Math.floor(start / 3) * 4, last = Math.ceil(end / 3) * 4;
  const bytes = atob(base64.slice(first, last));
  return bytes.slice(start % 3, start % 3 + end - start);
}
function isDocx(base64, size) {
  // Inspect the ZIP directory only. Do not inflate XML, extract paths, or run macros.
  const tailStart = Math.max(0, size - 65557), tail = base64Bytes(base64, tailStart, size);
  const end = tail.lastIndexOf('PK\x05\x06');
  if (end < 0 || end + 22 > tail.length) return false;
  if (readLittle(tail,end+4,2) || readLittle(tail,end+6,2) || end + 22 + readLittle(tail,end+20,2) !== tail.length) return false;
  const entries = readLittle(tail,end+10,2), length = readLittle(tail,end+12,4), offset = readLittle(tail,end+16,4);
  if (!entries || entries > 10000 || length > 4 * 1024 * 1024 || offset + length > tailStart + end) return false;
  const directory = base64Bytes(base64,offset,offset+length), names = new Set();
  let cursor = 0, totalInflated = 0;
  for (let i = 0; i < entries; i++) {
    if (directory.slice(cursor,cursor+4) !== 'PK\x01\x02' || cursor + 46 > directory.length) return false;
    const flags = readLittle(directory,cursor+8,2), uncompressed = readLittle(directory,cursor+24,4), nameLength = readLittle(directory,cursor+28,2), extra = readLittle(directory,cursor+30,2), comment = readLittle(directory,cursor+32,2);
    const filename = directory.slice(cursor+46,cursor+46+nameLength);
    totalInflated += uncompressed;
    if (flags & 1 || totalInflated > 128 * 1024 * 1024 || /^[/\\]/.test(filename) || filename.split(/[/\\]/).includes('..')) return false;
    names.add(filename); cursor += 46 + nameLength + extra + comment;
    if (cursor > directory.length) return false;
  }
  return cursor === directory.length && names.has('[Content_Types].xml') && names.has('word/document.xml');
}
function isEpub(base64,size){
  // An EPUB is not an arbitrary renamed ZIP. Require the standard uncompressed
  // first mimetype entry, container metadata, and a package document. Reading
  // and sanitizing package XHTML remains the reader's separate responsibility.
  const first=base64Bytes(base64,0,Math.min(size,58));
  if(first.length<58||first.slice(0,4)!=='PK\x03\x04'||readLittle(first,6,2)&1||readLittle(first,8,2)!==0||readLittle(first,18,4)!==20||readLittle(first,22,4)!==20||readLittle(first,26,2)!==8||readLittle(first,28,2)!==0||first.slice(30,38)!=='mimetype'||first.slice(38,58)!=='application/epub+zip')return false;
  const tailStart=Math.max(0,size-65557),tail=base64Bytes(base64,tailStart,size),end=tail.lastIndexOf('PK\x05\x06');
  if(end<0||end+22>tail.length||readLittle(tail,end+4,2)||readLittle(tail,end+6,2)||end+22+readLittle(tail,end+20,2)!==tail.length)return false;
  const entries=readLittle(tail,end+10,2),length=readLittle(tail,end+12,4),offset=readLittle(tail,end+16,4);
  if(!entries||entries>10000||entries!==readLittle(tail,end+8,2)||length>4*1024*1024||offset+length!==tailStart+end)return false;
  const directory=base64Bytes(base64,offset,offset+length),names=new Set();let cursor=0,totalInflated=0,mimetype=false;
  for(let i=0;i<entries;i++){
    if(directory.slice(cursor,cursor+4)!=='PK\x01\x02'||cursor+46>directory.length)return false;
    const flags=readLittle(directory,cursor+8,2),method=readLittle(directory,cursor+10,2),compressed=readLittle(directory,cursor+20,4),uncompressed=readLittle(directory,cursor+24,4),nameLength=readLittle(directory,cursor+28,2),extra=readLittle(directory,cursor+30,2),comment=readLittle(directory,cursor+32,2),localOffset=readLittle(directory,cursor+42,4),name=directory.slice(cursor+46,cursor+46+nameLength);
    totalInflated+=uncompressed;
    if(flags&1||![0,8].includes(method)||totalInflated>256*1024*1024||compressed>size||localOffset+30+nameLength>offset||!name||/[\\\x00]/.test(name)||name.startsWith('/')||name.split('/').some(part=>part==='..'||part==='.')||names.has(name))return false;
    if(name==='mimetype')mimetype=localOffset===0&&method===0&&compressed===20&&uncompressed===20;
    names.add(name);cursor+=46+nameLength+extra+comment;if(cursor>directory.length)return false;
  }
  return cursor===directory.length&&mimetype&&names.has('META-INF/container.xml')&&[...names].some(name=>/\.opf$/i.test(name));
}
function inspectFileDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 200) fail('附件超过64MiB');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(dataUrl);
  if (!match || !match[2] || match[2].length % 4 !== 0) fail('附件必须是有效的base64文件');
  const declaredMime = match[1].toLowerCase(), mime = canonicalMime(declaredMime);
  if (!supportedMime.has(declaredMime)) fail('附件类型不受支持，不支持SVG或HTML');
  const base64 = match[2];
  const size = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (size < 1 || size > MAX_ATTACHMENT_BYTES) fail('附件超过64MiB或为空');
  let header;
  try { header = atob(base64.slice(0, 88)); } catch { fail('附件base64格式无效'); }
  const riff = kind => header.startsWith('RIFF') && header.slice(8,12) === kind;
  const ftyp = header.slice(4,8) === 'ftyp', brands = header.slice(8);
  const signature = mime === 'application/pdf' ? header.startsWith('%PDF-')
    : mime === 'application/epub+zip' ? isEpub(base64,size)
    : mime === 'application/msword' ? header.startsWith('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')
    : mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? header.startsWith('PK\x03\x04') && isDocx(base64,size)
    : ['image/heic','image/heif'].includes(mime) ? ftyp && /heic|heix|hevc|hevx|mif1|msf1/.test(brands)
    : mime === 'video/mp4' || mime === 'audio/mp4' ? ftyp && /isom|iso[2-9]|mp4[12]|M4A |M4B |avc1|dash/.test(brands)
    : mime === 'video/quicktime' ? ftyp ? brands.includes('qt  ') : ['moov','mdat','wide','free'].includes(header.slice(4,8))
    : mime === 'video/x-msvideo' ? riff('AVI ')
    : ['audio/ogg','video/ogg','application/ogg'].includes(mime) ? header.startsWith('OggS')
    : mime === 'audio/wav' || mime === 'audio/x-wav' ? riff('WAVE')
    : mime === 'audio/flac' ? header.startsWith('fLaC')
    : mime === 'audio/mpeg' ? header.startsWith('ID3') || header.charCodeAt(0) === 255 && (header.charCodeAt(1) & 224) === 224
    : mime === 'audio/aac' ? header.startsWith('ADIF') || header.charCodeAt(0) === 255 && (header.charCodeAt(1) & 246) === 240
    : mime === 'image/png' ? header.startsWith('\x89PNG\r\n\x1a\n')
    : mime === 'image/jpeg' ? header.startsWith('\xff\xd8\xff')
    : mime === 'image/gif' ? /^GIF8[79]a/.test(header)
    : mime === 'image/webp' ? riff('WEBP')
    : mime === 'image/avif' ? header.slice(4, 8) === 'ftyp' && /avif|avis/.test(header.slice(8))
    : mime === 'image/bmp' ? header.startsWith('BM')
    : header.startsWith('II\x2a\0') || header.startsWith('MM\0\x2a');
  if (!signature) fail('附件文件头与类型不匹配');
  return {mime:declaredMime, size};
}
export function normalizeWorkspaceAttachment(value) {
  if (value === undefined || value === null) return null;
  if (!object(value)) fail('附件应为对象');
  const name = text(value.name, '附件名称', 1000);
  if (!name.trim() || /[\x00-\x1f\x7f]/.test(name)) fail('附件名称无效');
  if (/\.(?:html?|svg|xml|[cm]?js|exe|app|sh|command)$/i.test(name.trim())) fail('附件名称不能使用可执行网页或程序扩展名');
  const type = text(value.type, '附件类型', 100);
  if(type.trim().toLowerCase()==='application/epub+zip'&&!/\.epub$/i.test(name.trim()))fail('EPUB 原件需要使用 .epub 扩展名');
  const dataUrl = text(value.dataUrl, '附件内容', Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 200);
  const inspected = inspectFileDataUrl(dataUrl);
  if (canonicalMime(type.trim().toLowerCase()) !== canonicalMime(inspected.mime) || !supportedMime.has(type.trim().toLowerCase()) || !Number.isSafeInteger(value.size) || value.size !== inspected.size) fail('附件类型或字节数与内容不匹配');
  return {name, type, size:value.size, dataUrl};
}
const normalizeAttachment = normalizeWorkspaceAttachment;
function safeImage(value) {
  const image = text(value, '图片', Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 200).trim();
  if (!image) return '';
  if (safeSourceUrl(image)) return image;
  if (/^data:/i.test(image)) { try { return rasterMime.has(canonicalMime(inspectFileDataUrl(image).mime)) ? image : ''; } catch { return ''; } }
  if (/^blob:(?:https?:\/\/|mengcang:)/i.test(image) && !/[\x00-\x20\x7f]/.test(image)) return image;
  if (/^mengcang-asset:\/\/vault\/\?path=[^\s]+$/.test(image)) return image;
  if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(image) && !/[\\\x00-\x1f\x7f]/.test(image) && !image.split(/[/?#]/).some(part => part === '..')) return image;
  return '';
}

const typeAliases = Object.freeze(Object.assign(Object.create(null),{images:'image', photos:'image', photo:'image', articles:'article', links:'link', websites:'link', web:'link', highlights:'highlight', quotes:'quote', texts:'text', notes:'text', note:'text', videos:'video', audios:'audio', books:'book', files:'file', pdf:'file', socials:'social', instagram:'social', twitter:'social', x:'social', 'social media':'social'}));
function normalizeDocumentHighlight(value) {
  if(!object(value)||!Number.isSafeInteger(value.page)||value.page<1||value.page>1000000||!Array.isArray(value.rects)||value.rects.length>1000)fail('文档高亮格式不正确');
  const rects=value.rects.map(rect=>{if(!object(rect)||['x','y','width','height'].some(key=>!Number.isFinite(rect[key])||rect[key]<0||rect[key]>1)||!rect.width||!rect.height)fail('文档高亮位置不正确');return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};});
  return {id:id(value.id,'高亮标识'),page:value.page,text:text(value.text,'高亮文字'),rects};
}
function normalizeCard(value) {
  if (!object(value)) fail('卡片应为对象');
  const cardId = id(value.id, '卡片标识');
  const sourceUrl = safeSourceUrl(value.sourceUrl);
  const attachment = normalizeAttachment(value.attachment);
  const image = safeImage(value.image) || (attachment && rasterMime.has(canonicalMime(attachment.type.trim().toLowerCase())) ? attachment.dataUrl : '');
  const rawType = text(value.type, '卡片类型', 100).trim().toLowerCase();
  const attachmentKind = WORKSPACE_FILE_TYPES.find(entry=>entry.mime===attachment?.type.trim().toLowerCase())?.kind;
  const type = typeAliases[rawType] || rawType || (image ? 'image' : attachment ? ['image','heic'].includes(attachmentKind) ? 'image' : ['audio','video'].includes(attachmentKind) ? attachmentKind : 'file' : sourceUrl ? 'link' : 'text');
  const origin = value.origin ?? 'local';
  if (!['local', 'reference', 'vault'].includes(origin)) fail('卡片来源类型不受支持');
  const tags = list(value.tags, '标签').map(tag => text(tag, '标签', 120).trim()).filter(Boolean);
  if (value.page !== undefined && value.page !== null && typeof value.page !== 'string' && (typeof value.page !== 'number' || !Number.isSafeInteger(value.page) || value.page < 1)) fail('摘录页码应为文字或正整数');
  const page = value.page === undefined || value.page === null ? '' : text(String(value.page), '摘录页码', 1000);
  const sourceLocation = text(value.sourceLocation, '来源位置', 1000);
  const importFingerprint = text(value.importFingerprint, '导入识别标记', 150);
  const sourceAudioSha256 = text(value.sourceAudioSha256, '音频来源指纹', 64);
  if (sourceAudioSha256 && !/^[a-f\d]{64}$/i.test(sourceAudioSha256)) fail('音频来源指纹无效');
  const sourceAttachmentSha256 = text(value.sourceAttachmentSha256, '来源附件指纹', 64);
  if (sourceAttachmentSha256 && !/^[a-f\d]{64}$/i.test(sourceAttachmentSha256)) fail('来源附件指纹无效');
  if (/[\x00-\x1f\x7f]/.test(page + sourceLocation + importFingerprint)) fail('来源位置或导入标记包含控制字符');
  if (importFingerprint && !importFingerprint.startsWith('highlight-v1:')) fail('导入识别标记不受支持');
  return {
    id:cardId, path:value.path ? id(value.path, '卡片路径') : cardId,
    title:text(value.title, '卡片标题', 1000), body:text(value.body, '卡片正文', value.externalSource ? 200000 : 100000), caption:text(value.caption, '卡片配文', 50000),
    sourceUrl, sourceTitle:text(value.sourceTitle, '来源标题', 1000), author:text(value.author, '作者', 1000), type, image,
    createdAt:text(value.createdAt, '创建日期', 100), updatedAt:text(value.updatedAt, '修改日期', 100), date:text(value.date,'来源日期',100), ocrText:text(value.ocrText,'已有本地OCR',MAX_OCR_TEXT), tags:[...new Set(tags)], origin, attachment, page, sourceLocation, importFingerprint,
    sourceCardId:value.sourceCardId?id(value.sourceCardId,'来源卡片'):'',documentIndex:normalizeDocumentIndex(value.documentIndex),documentHighlights:attachment?keyed(value.documentHighlights,'文档高亮',normalizeDocumentHighlight):[],
    ...(sourceAudioSha256?{sourceAudioSha256:sourceAudioSha256.toLowerCase()}:{}),
    ...(sourceAttachmentSha256?{sourceAttachmentSha256:sourceAttachmentSha256.toLowerCase()}:{}),
    ...(value.externalSource ? {externalSource:normalizeRecallSource(value.externalSource)} : {}),
    ...(value.recallReceipt ? {recallReceipt:normalizeRecallReceipt(value.recallReceipt),recallDue:bool(value.recallDue ?? false,'待回看状态')} : {}),
  };
}
function normalizeCollection(value) {
  if (!object(value)) fail('收藏集应为对象');
  const title = text(value.title, '收藏集名称', 1000).trim();
  if (!title) fail('收藏集名称不能为空');
  return {id:id(value.id, '收藏集标识'), title, description:text(value.description, '收藏集描述', 50000), private:bool(value.private, '收藏集私密状态'), pinned:bool(value.pinned, '收藏集置顶状态'), cardIds:ids(value.cardIds, '收藏集卡片')};
}
function normalizeBoard(value, collectionIds) {
  if (!object(value)) fail('白板应为对象');
  const title = text(value.title, '白板名称', 1000).trim();
  if (!title) fail('白板名称不能为空');
  const collectionId = value.collectionId ? id(value.collectionId, '白板收藏集') : '';
  if (collectionId && !collectionIds.has(collectionId)) fail('白板引用了不存在的收藏集');
  const nodes = keyed(value.nodes, '白板节点', node => {
    if (!object(node) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) fail('白板节点坐标必须为有限数值');
    return {id:id(node.id, '节点标识'), itemPath:id(node.itemPath, '节点卡片路径'), x:node.x, y:node.y};
  });
  const nodeIds = new Set(nodes.map(node => node.id)), pairs = new Set();
  const edges = keyed(value.edges, '白板连线', edge => {
    if (!object(edge)) fail('白板连线应为对象');
    const from = id(edge.from ?? edge.source, '连线起点'), to = id(edge.to ?? edge.target, '连线终点');
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) fail('连线必须指向两个现有的不同节点');
    const pair = JSON.stringify([from, to].sort());
    if (pairs.has(pair)) fail('两个白板节点之间的连线重复');
    pairs.add(pair);
    return {id:id(edge.id, '连线标识'), from, to, ...(edge.label !== undefined ? {label:text(edge.label, '连线文字', 1000)} : {})};
  });
  return {id:id(value.id, '白板标识'), title, collectionId, nodes, edges};
}

function jsonCopy(value, depth = 0) {
  if (depth > 32) fail('草稿嵌套过深');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => jsonCopy(item, depth + 1));
  if (!object(value)) fail('草稿仅支持JSON数据');
  const copied = Object.fromEntries(Object.entries(value).map(([key, item]) => {
    id(key, '草稿属性');
    return [key, jsonCopy(item, depth + 1)];
  }));
  if (!own(copied,'image') && object(copied.attachment) && rasterMime.has(canonicalMime(String(copied.attachment.type || '').trim().toLowerCase()))) {
    try {copied.image = normalizeAttachment(copied.attachment).dataUrl;} catch {}
  }
  return copied;
}

export function createWorkspaceState() {
  return {schemaVersion:1, cards:[], savedIds:[], favoriteIds:[], hiddenIds:[], collections:[], boards:[], annotations:{}, drafts:{}, version:1};
}

export function normalizeWorkspaceState(raw) {
  if (raw === null || raw === undefined) return createWorkspaceState();
  if (!object(raw)) fail('状态应为对象');
  if ((raw.schemaVersion ?? 1) !== 1 || (raw.version ?? 1) !== 1) throw new Error('工作区版本不受支持，请保留原数据，不要覆盖。');
  const allowed = new Set(Object.keys(createWorkspaceState()));
  if (Object.keys(raw).some(key => !allowed.has(key))) fail('状态包含未知字段');
  const cards = keyed(raw.cards, '卡片', normalizeCard);
  const collections = keyed(raw.collections, '收藏集', normalizeCollection);
  const collectionIds = new Set(collections.map(collection => collection.id));
  const boards = keyed(raw.boards, '白板', value => normalizeBoard(value, collectionIds));
  if (raw.annotations !== undefined && !object(raw.annotations)) fail('注释应为对象');
  if (raw.drafts !== undefined && !object(raw.drafts)) fail('草稿应为对象');
  const annotations = Object.fromEntries(Object.entries(raw.annotations || {}).map(([cardId, entry]) => {
    id(cardId, '注释卡片标识');
    if (!object(entry)) fail('注释内容应为对象');
    const memberships = ids(entry.collectionIds, '注释收藏集');
    if (memberships.some(collectionId => !collectionIds.has(collectionId))) fail('注释引用了不存在的收藏集');
    return [cardId, {note:entry.note == null ? null : text(entry.note, '卡片注释', 50000), private:bool(entry.private, '注释私密状态'), collectionIds:memberships}];
  }));
  // Recover either side of a membership without discarding a saved association.
  // Native/Vault IDs stay valid when their source cards arrive from the adapter.
  for (const [cardId, annotation] of Object.entries(annotations)) for (const collectionId of annotation.collectionIds) {
    const collection = collections.find(collection => collection.id === collectionId);
    if (!collection.cardIds.includes(cardId)) collection.cardIds.push(cardId);
  }
  // Both membership sides may be individually valid but exceed the collection
  // limit when reconciled. Reject the whole input rather than drop associations
  // or return a state that cannot be normalized again on restore.
  for (const collection of collections) list(collection.cardIds, '收藏集卡片');
  for (const collection of collections) for (const cardId of collection.cardIds) {
    const annotation = own(annotations,cardId) ? annotations[cardId] : {note:null, private:false, collectionIds:[]};
    if (!annotation.collectionIds.includes(collection.id)) annotation.collectionIds.push(collection.id);
    annotations[cardId] = annotation;
  }
  return {schemaVersion:1, cards, savedIds:ids(raw.savedIds, '已保存卡片'), favoriteIds:ids(raw.favoriteIds, '喜欢的卡片'), hiddenIds:ids(raw.hiddenIds, '隐藏卡片'), collections, boards, annotations, drafts:jsonCopy(raw.drafts || {}), version:1};
}

export function migrateLegacyDiscovery(state, legacy) {
  const current = normalizeWorkspaceState(state);
  if (!object(legacy) || legacy.schema !== 1) throw new Error('旧发现页数据版本不受支持，请保留原数据，不要覆盖。');
  // Once imported, subsequent edits and removals belong to the new workspace.
  if (current.drafts.legacyDiscoveryImported === true) return current;
  if (!Array.isArray(legacy.collections) || !Array.isArray(legacy.boards)) fail('旧 Discovery 收藏集与白板应为数组');
  const collections = keyed(legacy.collections, '旧收藏集', value => {
    if (!object(value) || !Array.isArray(value.itemPaths)) fail('旧收藏集应包含内容路径数组');
    return normalizeCollection({id:value.id, title:value.title, description:'', private:false, pinned:false, cardIds:value.itemPaths});
  });
  const legacyCollectionIds = new Set(collections.map(value => value.id));
  const boards = keyed(legacy.boards, '旧白板', value => {
    if (!object(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) fail('旧白板应包含节点与连线数组');
    const pairs = new Set();
    const edges = keyed(value.edges, '旧白板连线', edge => {
      if (!object(edge)) fail('旧白板连线应为对象');
      return {id:id(edge.id, '旧连线标识'), from:id(edge.from ?? edge.source, '旧连线起点'), to:id(edge.to ?? edge.target, '旧连线终点'), ...(edge.label !== undefined ? {label:text(edge.label, '旧连线文字', 1000)} : {})};
    }).filter(edge => {
      const pair = JSON.stringify([edge.from, edge.to].sort());
      if (pairs.has(pair)) return false;
      pairs.add(pair);
      return true;
    });
    return normalizeBoard({...value, edges}, legacyCollectionIds);
  });
  const collectionIds = new Set(current.collections.map(value => value.id));
  const boardIds = new Set(current.boards.map(value => value.id));
  return normalizeWorkspaceState({
    ...current,
    savedIds:[...new Set([...current.savedIds, ...collections.flatMap(value => value.cardIds)])],
    collections:[...current.collections, ...collections.filter(value => !collectionIds.has(value.id))],
    boards:[...current.boards, ...boards.filter(value => !boardIds.has(value.id))],
    drafts:{...current.drafts, legacyDiscoveryImported:true},
  });
}

const setMembership = (values, value, selected) => selected ? [...new Set([...values, value])] : values.filter(item => item !== value);
const upsert = (values, value) => values.some(item => item.id === value.id) ? values.map(item => item.id === value.id ? value : item) : [...values, value];
const alignMemberships = (annotations, collectionId, cardIds) => Object.fromEntries(Object.entries(annotations).map(([cardId, entry]) => [cardId, {...entry, collectionIds:setMembership(entry.collectionIds, collectionId, cardIds.includes(cardId))}]));

export function workspaceReducer(state, action) {
  if (!object(action) || typeof action.type !== 'string') fail('操作应包含类型');
  const current = normalizeWorkspaceState(state);
  let next;
  switch (action.type) {
    case 'card.upsert': {
      if (!object(action.card)) fail('缺少卡片');
      const cardId = id(action.card.id, '卡片标识');
      const previous=current.cards.find(item => item.id === cardId),changed=!!previous&&own(action.card,'attachment')&&previous?.attachment?.dataUrl!==action.card.attachment?.dataUrl;
      const card = normalizeCard({...previous, ...action.card,...(changed?{documentIndex:null,documentHighlights:[]}: {})});
      next = {...current, cards:upsert(current.cards, card)};
      break;
    }
    case 'card.documentIndex': case 'card.highlight': case 'card.removeHighlight': {
      const cardId=id(action.id,'卡片标识'),card=current.cards.find(item=>item.id===cardId);
      if(!card?.attachment||card.attachment.dataUrl!==action.expectedDataUrl)fail('附件已更换，旧索引或高亮未保存');
      // Inspect the committed card, not the preview's earlier closure. Another
      // window may have adopted OCR while PDF.js was reading its text layer.
      const patch=action.type==='card.documentIndex'?{documentIndex:chooseDocumentTextIndex(card.documentIndex,action.index).index}:action.type==='card.highlight'?{documentHighlights:upsert(card.documentHighlights,normalizeDocumentHighlight(action.highlight))}:{documentHighlights:card.documentHighlights.filter(item=>item.id!==id(action.highlightId,'高亮标识'))};
      if(patch.documentHighlights?.length>5000)fail('高亮数量超过5000条');
      next={...current,cards:upsert(current.cards,{...card,...patch})};break;
    }
    case 'card.save': case 'card.favorite': case 'card.hide': {
      const cardId = id(action.id, '卡片标识');
      const [field, supplied] = action.type === 'card.save' ? ['savedIds', action.saved] : action.type === 'card.favorite' ? ['favoriteIds', action.value] : ['hiddenIds', action.hidden];
      const selected = supplied === undefined ? !current[field].includes(cardId) : bool(supplied, '操作选择状态');
      next = {...current, [field]:setMembership(current[field], cardId, selected)};
      break;
    }
    case 'card.note': {
      const cardId = id(action.id, '卡片标识'), previous = own(current.annotations,cardId) ? current.annotations[cardId] : {note:null, private:false, collectionIds:[]};
      next = {...current, annotations:{...current.annotations, [cardId]:{...previous, note:own(action, 'note') ? action.note == null ? null : text(action.note, '卡片注释', 50000) : previous.note, private:own(action, 'private') ? bool(action.private, '注释私密状态') : previous.private}}};
      break;
    }
    case 'collection.upsert': {
      if (!object(action.collection)) fail('缺少收藏集');
      const collectionId = id(action.collection.id, '收藏集标识');
      const collection = normalizeCollection({...current.collections.find(item => item.id === collectionId), ...action.collection});
      next = {...current, collections:upsert(current.collections, collection), annotations:alignMemberships(current.annotations, collectionId, collection.cardIds)};
      break;
    }
    case 'collection.delete': {
      const collectionId = id(action.id, '收藏集标识');
      next = {...current, collections:current.collections.filter(item => item.id !== collectionId), boards:current.boards.map(board => board.collectionId === collectionId ? {...board, collectionId:''} : board), annotations:Object.fromEntries(Object.entries(current.annotations).map(([cardId, value]) => [cardId, {...value, collectionIds:value.collectionIds.filter(value => value !== collectionId)}]))};
      break;
    }
    case 'collection.toggleCard': {
      const collectionId = id(action.id, '收藏集标识'), cardId = id(action.cardId, '卡片标识');
      const collection = current.collections.find(item => item.id === collectionId);
      if (!collection) fail('收藏集不存在');
      const selected = action.selected === undefined ? !collection.cardIds.includes(cardId) : bool(action.selected, '收藏集选择状态');
      const cardIds = setMembership(collection.cardIds, cardId, selected);
      next = {...current, collections:current.collections.map(item => item.id === collectionId ? {...item, cardIds} : item), annotations:alignMemberships(current.annotations, collectionId, cardIds), ...(selected ? {savedIds:setMembership(current.savedIds,cardId,true), hiddenIds:setMembership(current.hiddenIds,cardId,false)} : {})};
      break;
    }
    case 'board.upsert': {
      if (!object(action.board)) fail('缺少白板');
      const boardId = id(action.board.id, '白板标识');
      const board = normalizeBoard({...current.boards.find(item => item.id === boardId), ...action.board}, new Set(current.collections.map(item => item.id)));
      next = {...current, boards:upsert(current.boards, board)};
      break;
    }
    case 'board.delete': next = {...current, boards:current.boards.filter(item => item.id !== id(action.id, '白板标识'))}; break;
    case 'draft.set': {
      const key = id(action.key, '草稿标识'), drafts = {...current.drafts};
      if (action.value === null) delete drafts[key];
      else drafts[key] = jsonCopy(action.value);
      next = {...current, drafts};
      break;
    }
    default: return state;
  }
  return normalizeWorkspaceState(next);
}

function mediaMatches(card, filter) {
  const target = typeAliases[filter] || filter;
  if (!target || target === 'all') return true;
  const rawType = String(card.type || '').toLowerCase();
  const type = typeAliases[rawType] || rawType;
  if (target === 'image') return type === 'image';
  if (target === 'article') return type === 'article';
  if (target === 'link') return type === 'link';
  if (target === 'text') return type === 'text';
  if (target === 'highlight' || target === 'quote') return ['highlight', 'quote'].includes(type);
  return type === target;
}

const keywordFields=(card,annotation)=>[[card.title,8],[Array.isArray(card.tags)?card.tags.join(' '):'',6],[card.sourceTitle,3],[card.author,3],[card.caption,2],[annotation?.note,2],[card.body,1],[card.ocrText,1],[card.documentIndex?.text,1],[card.sourceUrl,0.5]];

export function selectCards(cards, state, filters = {}, readOnlySavedIds = []) {
  const current = normalizeWorkspaceState(state);
  const terms = String(filters.query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const collection = filters.collectionId && filters.collectionId !== 'all' ? current.collections.find(item => item.id === filters.collectionId) : null;
  const membership = collection ? new Set(collection.cardIds) : null;
  // Native files are already saved, but are not embedded persisted card state.
  // Keep their read-only membership separate from the 20,000-item storage cap.
  if(!Array.isArray(readOnlySavedIds))fail('只读来源卡片身份应为数组');
  const saved = new Set([...current.savedIds,...Array.from(readOnlySavedIds,value=>id(value,'只读来源卡片'))]), favorite = new Set(current.favoriteIds), hidden = new Set(current.hiddenIds);
  const savedFilter = filters.saved ?? filters.inLibrary ?? filters.inlibrary;
  const favoriteFilter = filters.favorite ?? filters.favorites;
  const media = String(filters.media ?? filters.type ?? 'all').toLowerCase();
  const candidates=cards===undefined?[]:cards;
  if(!Array.isArray(candidates))fail('待筛选卡片应为数组');
  const results = candidates.filter(card => {
    if (!card || typeof card.id !== 'string') return false;
    if (filters.hidden === true ? !hidden.has(card.id) : filters.includeHidden !== true && hidden.has(card.id)) return false;
    if (filters.collectionId && filters.collectionId !== 'all' && (!membership || !membership.has(card.id))) return false;
    if (typeof savedFilter === 'boolean' && saved.has(card.id) !== savedFilter) return false;
    if (typeof favoriteFilter === 'boolean' && favorite.has(card.id) !== favoriteFilter) return false;
    if (filters.origin && card.origin !== filters.origin) return false;
    if (!mediaMatches(card, media)) return false;
    const annotation = current.annotations[card.id];
    const haystack = keywordFields(card,annotation).map(([value])=>value).filter(value => typeof value === 'string').join(' ').toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  const date = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const sort = filters.sort ?? filters.sortBy ?? 'newest';
  if (sort === 'relevant' && terms.length) {
    const relevance = card => {
      const fields = keywordFields(card,current.annotations[card.id]);
      return fields.reduce((score,[value,weight]) => {
        const field = String(value || '').toLocaleLowerCase();
        for (const term of terms) {
          let offset=0,count=0,found;
          while (count<10 && (found=field.indexOf(term,offset))>=0) {count++;offset=found+term.length;}
          if(count) score += weight * (1 + Math.log2(count));
        }
        if(terms.length>1 && field.includes(terms.join(' '))) score += weight;
        return score;
      },0);
    };
    const scores = new Map(results.map(card => [card.id,relevance(card)]));
    results.sort((a,b)=>scores.get(b.id)-scores.get(a.id) || date(b.updatedAt || b.createdAt)-date(a.updatedAt || a.createdAt));
  } else if (sort === 'title') results.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  else if (sort === 'oldest') results.sort((a, b) => date(a.createdAt) - date(b.createdAt));
  else if (['updated', 'modified'].includes(sort)) results.sort((a, b) => date(b.updatedAt || b.createdAt) - date(a.updatedAt || a.createdAt));
  else if (['newest', 'recent'].includes(sort)) results.sort((a, b) => date(b.createdAt) - date(a.createdAt));
  return results;
}

export function serializeWorkspace(state) {
  const safe = normalizeWorkspaceState(state);
  const compact = value => {
    if (Array.isArray(value)) return value.map(compact);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key,item]) => !(key==='image' && typeof item==='string' && rasterMime.has(canonicalMime(String(value.attachment?.type || '').trim().toLowerCase())) && value.attachment?.dataUrl===item)).map(([key,item])=>[key,compact(item)]));
  };
  const compacted = compact(safe);
  let minimumBytes = 0;
  const estimate = value => {
    if (typeof value === 'string') minimumBytes += value.length + 2;
    else if (Array.isArray(value)) {minimumBytes += value.length + 2;value.forEach(estimate);}
    else if (object(value)) {minimumBytes += Object.keys(value).length * 2 + 2;for(const [key,item] of Object.entries(value)){minimumBytes+=key.length+2;estimate(item);}}
    else minimumBytes += String(value).length;
    if(minimumBytes>MAX_WORKSPACE_BACKUP_BYTES) fail('工作区超过256MiB总上限，请先导出并整理附件，当前草稿仍保留');
  };
  estimate(compacted);
  const serialized = JSON.stringify(compacted);
  if (new Blob([serialized]).size > MAX_WORKSPACE_BACKUP_BYTES) fail('工作区超过256MiB总上限，请先整理附件，当前草稿仍保留');
  return serialized;
}

export function parseWorkspaceBackup(value) {
  if (typeof value !== 'string') fail('备份应为JSON文字');
  if (value.length > MAX_WORKSPACE_BACKUP_BYTES || new Blob([value]).size > MAX_WORKSPACE_BACKUP_BYTES) fail('备份超过256MiB导入上限');
  const parsed = JSON.parse(value);
  if (!object(parsed) || parsed.schemaVersion !== 1) fail('备份缺少受支持的工作区版本');
  return normalizeWorkspaceState(parsed);
}

function backupDraftDescriptor(key, value) {
  if (!key.startsWith('window-draft:')) return {logicalKey:key, scoped:false};
  if (!object(value) || typeof value.key !== 'string' || !own(value, 'value')) return null;
  const editor = /^(?:edit|new|collection|note|board|vault):([\s\S]+)$/.exec(value.key);
  if (!editor) return null;
  // The editor prefix is not part of the original entity's 4096-character ID.
  // Validate that ID without trimming or shortening the stored logical key.
  try {id(editor[1], '窗口草稿标识'); return {logicalKey:value.key, scoped:true};} catch {return null;}
}
function backupRecoveryDraftKey(logicalKey, record) {
  // Stable import identity makes re-imports idempotent; it is not an integrity
  // hash. Collisions are checked against the complete record before reuse.
  const input = JSON.stringify(record);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  // Keep the display suffix within the storage-key limit, encoding whole code
  // points. The full original identity remains in the hash input and record;
  // lone surrogates are replaced only in this non-authoritative display label.
  let label = '';
  for (const character of logicalKey) {
    const encoded = encodeURIComponent(character.length === 1 && /[\ud800-\udfff]/.test(character) ? '\ufffd' : character);
    if (label.length + encoded.length > 4000) break;
    label += encoded;
  }
  return `window-draft:backup-recovery-${(hash >>> 0).toString(36)}:${label}`;
}
function planWorkspaceBackupMerge(existing, incoming, context = {}) {
  if (!object(context) || Object.keys(context).some(key => !['knownCardIds', 'knownCardPaths'].includes(key))) fail('备份合并上下文格式不正确');
  const loadedCardIds = new Set();
  const knownReferences = ['knownCardIds', 'knownCardPaths'].flatMap(field => {
    const values = context[field] ?? [];
    if (!Array.isArray(values) || values.length > 40000) fail('已载入卡片身份应为数组且不超过40000项');
    return values.map(value => {const normalized = id(value, '已载入卡片身份'); if (field === 'knownCardIds') loadedCardIds.add(normalized); return normalized;});
  });
  const current = normalizeWorkspaceState(existing), backup = normalizeWorkspaceState(incoming);
  const currentCardIds = new Set(current.cards.map(card => card.id));
  const currentLogicalDraftKeys = new Set(Object.entries(current.drafts).flatMap(([key, value]) => {
    const descriptor = backupDraftDescriptor(key, value);
    return descriptor ? [descriptor.logicalKey] : [];
  }));
  // A native card may not be embedded in the backup. Its local flags, notes,
  // collection memberships or canvas positions still identify existing content.
  const currentIdentities = new Set([
    ...knownReferences,
    ...current.cards.flatMap(card => [card.id, card.path]),
    ...current.savedIds, ...current.favoriteIds, ...current.hiddenIds,
    ...Object.keys(current.annotations), ...current.collections.flatMap(collection => collection.cardIds),
    ...current.boards.flatMap(board => board.nodes.map(node => node.itemPath)),
    ...[...currentLogicalDraftKeys].flatMap(key => /^(?:edit|note|vault):(.+)$/.exec(key)?.slice(1) || []),
  ]);
  // Local cards take precedence in the renderer's ID map. Do not let an old
  // embedded card shadow a native card actually loaded in this workspace. Mere
  // flags, notes or paths still allow an otherwise unavailable body to restore.
  const addedCards = backup.cards.filter(card => !currentCardIds.has(card.id) && !loadedCardIds.has(card.id));
  const freshCardIds = new Set(addedCards.filter(card => !currentIdentities.has(card.id)).map(card => card.id));
  const resolvable = new Set([...currentIdentities, ...addedCards.flatMap(card => [card.id, card.path])]);
  const skippedExternal = new Set();
  const keepReference = cardId => {
    if (resolvable.has(cardId)) return true;
    skippedExternal.add(cardId);
    return false;
  };
  const currentCollectionIds = new Set(current.collections.map(collection => collection.id));
  const addedCollections = backup.collections.filter(collection => !currentCollectionIds.has(collection.id)).map(collection => ({
    ...collection, cardIds:collection.cardIds.filter(keepReference),
  }));
  const addedCollectionIds = new Set(addedCollections.map(collection => collection.id));
  const currentBoardIds = new Set(current.boards.map(board => board.id));
  const addedBoards = backup.boards.filter(board => !currentBoardIds.has(board.id)).map(board => {
    const nodes = board.nodes.filter(node => keepReference(node.itemPath));
    const nodeIds = new Set(nodes.map(node => node.id));
    return {...board, nodes, edges:board.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to))};
  });
  // Absence from a current flag array means false, and must not be replaced by
  // an older true value. Only identities newly supplied as actual cards inherit
  // these backup flags. Unresolved external IDs cannot revive old local state.
  const mergeFlags = field => [...current[field], ...backup[field].filter(cardId => {
    keepReference(cardId);
    return freshCardIds.has(cardId);
  })];
  const annotations = {...current.annotations};
  for (const [cardId, annotation] of Object.entries(backup.annotations)) {
    keepReference(cardId);
    if (freshCardIds.has(cardId)) annotations[cardId] = {
      ...annotation,
      // An existing collection is preserved as a whole; old annotation metadata
      // must not silently add a card that the user has since removed from it.
      collectionIds:annotation.collectionIds.filter(collectionId => addedCollectionIds.has(collectionId)),
    };
  }
  const drafts = {...current.drafts};
  let preservedDrafts = 0, skippedDrafts = 0, recoveryDrafts = 0, recoveredNotes = 0, mergedReaderRecords = 0;
  for (const [key, value] of Object.entries(backup.drafts)) {
    if(key.startsWith('reader:')){
      const merged=mergeReaderBackupState(own(current.drafts,key)?current.drafts[key]:undefined,value);
      if(own(current.drafts,key)&&JSON.stringify(merged)===JSON.stringify(current.drafts[key]))preservedDrafts++;
      else{drafts[key]=merged;if(own(current.drafts,key))mergedReaderRecords++;}
      continue;
    }
    const descriptor = backupDraftDescriptor(key, value);
    if (!descriptor) {skippedDrafts++; continue;}
    if (own(current.drafts, key) && (!descriptor.scoped || JSON.stringify(current.drafts[key]?.value) === JSON.stringify(value.value))) {preservedDrafts++; continue;}
    const {logicalKey, scoped} = descriptor;
    const cardDraft = /^(edit|note|vault):(.+)$/.exec(logicalKey);
    const collectionDraft = /^collection:(.+)$/.exec(logicalKey);
    const boardDraft = /^board:(.+)$/.exec(logicalKey);
    if (cardDraft) {
      const resolved = keepReference(cardDraft[2]);
      // Native write retry IDs belong to their original local session. Importing
      // a backup never reintroduces a saved/queued native write request.
      if (cardDraft[1] === 'vault' || (!scoped && (!resolved || !freshCardIds.has(cardDraft[2])))) {skippedDrafts++; continue;}
    } else if (collectionDraft && collectionDraft[1] !== 'new' && !scoped && !addedCollectionIds.has(collectionDraft[1])) {
      skippedDrafts++; continue;
    } else if (boardDraft && !scoped && (currentBoardIds.has(boardDraft[1]) || !addedBoards.some(board => board.id === boardDraft[1]))) {
      skippedDrafts++; continue;
    }
    if (!scoped) {drafts[key] = value; continue;}
    const recoveryOnly = !!value.recoveryOnly || currentLogicalDraftKeys.has(logicalKey) || !!cardDraft && !freshCardIds.has(cardDraft[2]) || !!collectionDraft && collectionDraft[1] !== 'new' && (currentCollectionIds.has(collectionDraft[1]) || !addedCollectionIds.has(collectionDraft[1])) || !!boardDraft && (currentBoardIds.has(boardDraft[1]) || !addedBoards.some(board => board.id === boardDraft[1]));
    // Storage revisions from another backup cannot serve as local edit bases.
    // A stale existing-entity draft stays a manual recovery copy; the session
    // forces conflicted recovery to be saved as a new card rather than overwrite.
    const imported = {...value, key:logicalKey, base:null, adoptedFrom:null, imported:true, recoveryOnly, conflict:recoveryOnly || !!value.conflict};
    let storageKey = own(current.drafts, key) ? backupRecoveryDraftKey(logicalKey, imported) : key;
    const baseKey = storageKey;
    let suffix = 1;
    while (own(drafts, storageKey) && JSON.stringify(drafts[storageKey]) !== JSON.stringify(imported)) storageKey = `${baseKey}:${suffix++}`;
    if (own(drafts, storageKey)) {preservedDrafts++; continue;}
    drafts[storageKey] = imported;
    if (recoveryOnly) recoveryDrafts++;
  }
  // A current (including cleared) note always wins. Keep unused backup prose
  // available as manual recovery, even when its original native card is absent.
  // Only exact, already-manual note copies suppress another recovery record;
  // different privacy or extra draft fields must not discard either payload.
  const retainedNotes = new Set(Object.entries(drafts).flatMap(([key, record]) => {
    const descriptor = backupDraftDescriptor(key, record), value = record?.value;
    return descriptor?.scoped && descriptor.logicalKey.startsWith('note:') && record.recoveryOnly === true && record.conflict === true && object(value) && Object.keys(value).length === 2 && typeof value.note === 'string' && typeof value.private === 'boolean'
      ? [JSON.stringify([descriptor.logicalKey, value.note, value.private])] : [];
  }));
  for (const [cardId, annotation] of Object.entries(backup.annotations)) {
    if (!annotation.note?.trim() || own(annotations, cardId) && annotations[cardId].note === annotation.note) continue;
    const logicalKey = `note:${cardId}`, signature = JSON.stringify([logicalKey, annotation.note, annotation.private]);
    if (retainedNotes.has(signature)) continue;
    const imported = {key:logicalKey, value:{note:annotation.note, private:annotation.private}, base:null, adoptedFrom:null, imported:true, recoveryOnly:true, conflict:true};
    const baseKey = backupRecoveryDraftKey(logicalKey, imported);
    let storageKey = baseKey, suffix = 1;
    while (own(drafts, storageKey) && JSON.stringify(drafts[storageKey]) !== JSON.stringify(imported)) storageKey = `${baseKey}:${suffix++}`;
    if (own(drafts, storageKey)) continue;
    drafts[storageKey] = imported;
    retainedNotes.add(signature);
    recoveryDrafts++; recoveredNotes++;
  }
  const backupStateIds = new Set([...backup.cards.map(card => card.id), ...backup.savedIds, ...backup.favoriteIds, ...backup.hiddenIds, ...Object.keys(backup.annotations)]);
  const state = normalizeWorkspaceState({
    ...current,
    cards:[...current.cards, ...addedCards], savedIds:mergeFlags('savedIds'), favoriteIds:mergeFlags('favoriteIds'), hiddenIds:mergeFlags('hiddenIds'),
    collections:[...current.collections, ...addedCollections], boards:[...current.boards, ...addedBoards], annotations, drafts,
  });
  return {state, summary:{
    addedCards:addedCards.length,
    preservedCards:backup.cards.length - addedCards.length,
    preservedCardStates:[...backupStateIds].filter(cardId => currentIdentities.has(cardId)).length,
    addedCollections:addedCollections.length,
    preservedCollections:backup.collections.length - addedCollections.length,
    addedBoards:addedBoards.length,
    preservedBoards:backup.boards.length - addedBoards.length,
    addedMemberships:addedCollections.reduce((total, collection) => total + collection.cardIds.length, 0),
    addedMembershipsForExistingCards:addedCollections.reduce((total, collection) => total + collection.cardIds.filter(cardId => currentIdentities.has(cardId)).length, 0),
    skippedExternalReferences:skippedExternal.size,
    addedDrafts:Object.keys(drafts).length - Object.keys(current.drafts).length,
    preservedDrafts, skippedDrafts, recoveryDrafts, recoveredNotes, ...(mergedReaderRecords?{mergedReaderRecords}:{}),
  }};
}

// Recompute against the latest stored state at commit time, not the state used
// to display the import preview. Both inputs remain untouched.
export function mergeWorkspaceBackup(existing, incoming, context) {
  return planWorkspaceBackupMerge(existing, incoming, context).state;
}

export function previewWorkspaceBackupMerge(existing, incoming, context) {
  return planWorkspaceBackupMerge(existing, incoming, context).summary;
}

export function exportCards(cards, format = 'markdown') {
  // Explicit card fields prevent raw DTOs, annotations, draft state, and operation
  // metadata from entering an export. Content export is a format conversion only.
  const requested = list(cards, '导出卡片');
  const publicCards = requested.map(card => ({id:id(card.id, '卡片标识'), title:text(card.title, '卡片标题', 1000), body:text(card.body, '卡片正文', card.externalSource ? 200000 : 100000), caption:text(card.caption, '卡片配文', 50000), sourceUrl:safeSourceUrl(card.sourceUrl), sourceTitle:text(card.sourceTitle, '来源标题', 1000), author:text(card.author, '作者', 1000), page:card.page === undefined || card.page === null ? '' : text(String(card.page), '摘录页码', 1000), sourceLocation:text(card.sourceLocation, '来源位置', 1000), date:text(card.date || card.createdAt, '来源日期', 100), type:text(card.type,'卡片类型',100), ocrText:text(card.ocrText,'已有本地OCR',MAX_OCR_TEXT), ...(card.documentIndex?{documentIndex:normalizeDocumentIndex(card.documentIndex)}:{}), tags:Array.isArray(card.tags)?card.tags.map(tag=>text(tag,'标签',120)):[]}));
  const fileRefs = requested.map(card => {
    const file = normalizeAttachment(card.attachment), image = safeImage(card.image);
    return {attachment:file ? {name:file.name, type:file.type, size:file.size} : null, imageReference:/^(?:data:|blob:)/i.test(image) ? '' : image};
  });
  const output = exportSelectedItems(publicCards, publicCards.map(card => card.id), format);
  if (!fileRefs.some(ref => ref.attachment || ref.imageReference)) return output;
  const type = format.toLowerCase();
  if (type === 'json') return JSON.stringify(JSON.parse(output).map((record, index) => ({...record, ...fileRefs[index]})), null, 2);
  if (type === 'csv') {
    const rows = parseCsv(output);
    rows[0].push('Attachment Name', 'Attachment Type', 'Attachment Bytes', 'Image Reference');
    rows.slice(1).forEach((row, index) => { const file = fileRefs[index]; row.push(file.attachment?.name || '', file.attachment?.type || '', String(file.attachment?.size ?? ''), file.imageReference); });
    const cell = value => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    return rows.map(row => row.map(cell).join(',')).join('\r\n');
  }
  const files = fileRefs.flatMap((ref, index) => ref.attachment || ref.imageReference ? [`### 文件引用 · ${index + 1}\n\n${ref.attachment ? `- 名称：${ref.attachment.name}\n- 类型：${ref.attachment.type}\n- 字节数：${ref.attachment.size}\n` : ''}${ref.imageReference ? `- 图片引用：${ref.imageReference}\n` : ''}`] : []);
  return `${output}\n\n${files.join('\n\n')}\n\n完整附件仅包含在工作区 JSON 备份中。`;
}

export const AI_MODES = Object.freeze(['The Gist', 'Explain Like I’m 5', 'Contrarian Take', 'Analogy', 'Hot Take']);
export function aiPlaceholder(mode = AI_MODES[0]) {
  const selectedMode = typeof mode === 'string' ? mode : AI_MODES[0];
  return Object.freeze({mode:selectedMode, title:selectedMode || 'AI', enabled:false, message:'AI 功能入口已保留，本次不会发送请求或消耗任何 AI 次数。'});
}
