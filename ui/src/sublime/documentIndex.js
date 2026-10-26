// Pure saved-text metadata. No PDF parsing, OCR, model, storage or network access.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const fail=message=>{throw Error(`工作区数据无效：${message}。请保留原数据后重试。`);};
const text=(value,label,limit=1000000)=>{if(value==null)return '';if(typeof value!=='string'||value.length>limit||value.includes('\0'))fail(`${label}应为有效文字`);return value;};
export function normalizeDocumentIndex(value){
 if(value==null)return null;
 if(!object(value)||!Number.isSafeInteger(value.pageCount)||value.pageCount<0||value.pageCount>1000000||!Array.isArray(value.pages)||value.pages.length>1500)fail('文档索引格式不正确');
 const pages=value.pages.map(item=>{if(!object(item)||!Number.isSafeInteger(item.page)||item.page<1||item.page>value.pageCount)fail('文档索引页码不正确');return {page:item.page,text:text(item.text,'文档页文字'),...(own(item,'engine')?{engine:text(item.engine,'文档页引擎',200)}:{})};});
 if(pages.reduce((sum,item)=>sum+item.text.length,0)>1000000||new Set(pages.map(item=>item.page)).size!==pages.length)fail('文档索引过长或页码重复');
 if(value.truncated!==undefined&&typeof value.truncated!=='boolean')fail('部分索引应为布尔值');
 if(value.source!==undefined&&!['ocr','pdf-text-layer','mixed'].includes(value.source))fail('文档索引来源不受支持');
 return {text:text(value.text,'文档索引'),pages,pageCount:value.pageCount,truncated:value.truncated??false,indexedAt:text(value.indexedAt,'索引日期',100),...(value.source!==undefined?{source:value.source}:{}),...(own(value,'engine')?{engine:text(value.engine,'文档索引引擎',200)}:{})};
}
/** Adopt only page numbers actually returned by the native extraction result. */
export function documentIndexFromOcr(result,{now=new Date().toISOString()}={}){
 if(!object(result))fail('识别结果格式不正确');
 const fullText=text(result.text,'已有本地OCR'),pages=result.pages??[];
 if(!Array.isArray(pages)||pages.length>100)fail('识别分页格式不正确');
 let previous=0;
 const checked=pages.map(page=>{if(!object(page)||!Number.isSafeInteger(page.page)||page.page<=previous||page.page>100)fail('识别页码不正确');previous=page.page;return {page:page.page,text:text(page.text,'识别页文字',200000),engine:text(page.engine,'识别页引擎',200)};});
 if(checked.length&&checked.map(page=>page.text).join('\n\n')!==fullText)fail('识别全文与分页文字不一致，未丢弃任一版本');
 return normalizeDocumentIndex({text:fullText,pages:checked,pageCount:previous,truncated:checked.length>0&&checked.length!==previous,indexedAt:now,source:'ocr',engine:text(result.engine,'识别引擎',200)});
}
/** Reading a text layer never silently discards saved OCR page provenance. */
export function chooseDocumentTextIndex(existing,candidate){
 const next=normalizeDocumentIndex(candidate);
 if(!['ocr','mixed'].includes(existing?.source))return {index:next,retainedOcr:false};
 return {index:normalizeDocumentIndex(existing),retainedOcr:true,hasTextLayer:!!next?.text.trim()};
}
