// Shared, dependency-free validation for the companion and the native library.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const badUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export function recallError(code, message) { const error = new Error(message); error.code = code; return error; }
const fail = message => { throw recallError('INVALID_RECALL', message); };
function shape(value, keys) { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail('回看请求包含不支持的字段'); }
function text(value, max, label, empty = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || badUnicode.test(value) || (!empty && !value.trim())) fail(`${label}无效`);
  return value;
}
function identity(value, label) { const result = text(value, 256, label); if (/[\x00-\x1f\x7f]/.test(result)) fail(`${label}包含控制字符`); return result; }
function offset(value) { if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail('来源位置无效'); return value; }
export function normalizeRecallSource(value) {
  shape(value, ['version','provider','instanceId','sessionId','messageId','eventSeq','turn','sessionTitle','selection']);
  if (value.version !== 1 || value.provider !== 'deepseek-harness') fail('不支持的回看来源版本');
  const source = {version:1,provider:'deepseek-harness',instanceId:identity(value.instanceId,'来源实例'),sessionId:identity(value.sessionId,'来源聊天'),messageId:identity(value.messageId,'来源消息'),eventSeq:offset(value.eventSeq),turn:offset(value.turn),sessionTitle:text(value.sessionTitle,500,'聊天标题',true)};
  if (value.selection !== undefined) {
    const selected = value.selection;
    shape(selected, ['text','start','end','prefix','suffix']);
    const selection = {text:text(selected.text,200000,'选中文字'),start:offset(selected.start),end:offset(selected.end),prefix:text(selected.prefix,128,'选区前文',true),suffix:text(selected.suffix,128,'选区后文',true)};
    if (selection.end <= selection.start || selection.end - selection.start !== selection.text.length) fail('选区长度与来源位置不一致');
    source.selection = selection;
  }
  return source;
}
export function normalizeRecallCapture(value) {
  shape(value, ['requestId','text','title','externalSource']);
  if (typeof value.requestId !== 'string' || !UUID.test(value.requestId)) fail('收藏请求标识必须是 UUID');
  const result = {requestId:value.requestId.toLowerCase(),text:text(value.text,200000,'回看原文'),title:text(value.title,500,'回看标题'),externalSource:normalizeRecallSource(value.externalSource)};
  if (result.externalSource.selection && result.externalSource.selection.text !== result.text) fail('收藏原文必须与选中文字一致');
  return result;
}
export function normalizeRecallReceipt(value) {
  shape(value, ['requestId','payloadHash','savedAt']);
  if (typeof value.requestId !== 'string' || !UUID.test(value.requestId) || !/^[a-f0-9]{64}$/.test(value.payloadHash || '')) fail('收藏回执无效');
  const savedAt = text(value.savedAt,40,'收藏时间');
  if (!Number.isFinite(Date.parse(savedAt)) || new Date(savedAt).toISOString() !== savedAt) fail('收藏时间无效');
  return {requestId:value.requestId.toLowerCase(),payloadHash:value.payloadHash,savedAt};
}
export function normalizeRecallParams(method, value) {
  if (method === 'capture') return normalizeRecallCapture(value);
  if (method === 'status') { shape(value, []); return {}; }
  if (method === 'list') { shape(value, ['instanceId','sessionId']); return {instanceId:identity(value.instanceId,'来源实例'),sessionId:identity(value.sessionId,'来源聊天')}; }
  if (method === 'get' || method === 'setReview') {
    shape(value, method === 'get' ? ['id'] : ['id','due']);
    const result = {id:identity(value.id,'回看条目标识')};
    if (method === 'setReview') { if (typeof value.due !== 'boolean') fail('待回看状态无效'); result.due=value.due; }
    return result;
  }
  throw recallError('METHOD_NOT_FOUND','不支持的回看操作');
}
