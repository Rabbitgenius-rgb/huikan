import React from 'react';
import {safeSourceUrl} from './sublime/workspaceModel.js';
const validUrl=value=>Boolean(safeSourceUrl(value));
// Index delimiter pairs once. Unclosed/nested brackets must not make each
// possible link opener scan the same long suffix again.
function richLinkEnds(text) {
  const brackets=new Map(),parentheses=new Map(),bracketStack=[],parenthesisStack=[];
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(char==='\\'&&/[\\[\]()]/.test(text[index+1] || '')){index++;continue;}
    if(char==='\n'){bracketStack.length=0;parenthesisStack.length=0;}
    else if(char==='[')bracketStack.push(index);
    else if(char===']'&&bracketStack.length)brackets.set(bracketStack.pop(),index);
    else if(char==='(')parenthesisStack.push(index);
    else if(char===')'&&parenthesisStack.length)parentheses.set(parenthesisStack.pop(),index);
  }
  return {brackets,parentheses};
}
function richInline(value,depth=0,links=true,linkLabel=false,markdown=false,onReference) {
  const plain=text=>linkLabel?text.replace(/\\([\\[\]*])/g,'$1'):text;
  if(depth>8)return plain(String(value));
  const text=String(value),parts=[],ends=links?richLinkEnds(text):null;
  const basePattern=links?/\[|\\[\\[\]*]|\*\*\*(?<both>(?:\\[^\n]|[^*\\\n])+)\*\*\*|\*\*(?<bold>(?:\\[^\n]|[^*\\\n])+)\*\*|\*(?<italic>(?:\\[^\n]|[^*\\\n])+)\*/g:/\\[\\[\]*]|\*\*\*(?<both>(?:\\[^\n]|[^*\\\n])+)\*\*\*|\*\*(?<bold>(?:\\[^\n]|[^*\\\n])+)\*\*|\*(?<italic>(?:\\[^\n]|[^*\\\n])+)\*/g;
  const pattern=markdown?new RegExp('`[^`\\n]+`|'+basePattern.source,'g'):basePattern;
  let match,last=0,key=0;
  while((match=pattern.exec(text))){
    if(markdown&&match[0].startsWith('`')){
      if(match.index>last)parts.push(plain(text.slice(last,match.index)));
      parts.push(<code key={key++}>{match[0].slice(1,-1)}</code>);
      last=pattern.lastIndex;continue;
    }
    if(match[0]==='['){
      const wikiEnd=markdown&&text[match.index+1]==='['?ends.brackets.get(match.index):undefined;
      if(wikiEnd!==undefined&&text[wikiEnd-1]===']'){
        const attachment=text[match.index-1]==='!'&&match.index>last,start=match.index-(attachment?1:0);
        if(start>last)parts.push(plain(text.slice(last,start)));
        const [target,label]=text.slice(match.index+2,wikiEnd-1).split('|');
        const name=attachment?target.split('/').pop():label||target.split('/').pop().replace(/\.md$/i,'');
        parts.push(!attachment&&onReference?<button type="button" key={key++} className="se-inline-reference" onClick={()=>onReference(target)}>{name}</button>:<span key={key++} className={attachment?'se-inline-attachment':'se-inline-reference'}>{name}</span>);
        last=wikiEnd+1;pattern.lastIndex=last;continue;
      }
      const labelEnd=ends.brackets.get(match.index),urlStart=labelEnd+2,end=ends.parentheses.get(labelEnd+1);
      if(labelEnd===undefined||labelEnd===match.index+1||text[labelEnd+1]!=='('||end===undefined||!/^https?:\/\//i.test(text.slice(urlStart,urlStart+8)))continue;
      // Only emitted URL delimiter/format-marker escapes are decoded. Safety
      // (including credentials and other backslashes) still uses safeSourceUrl.
      const url=text.slice(urlStart,end).replace(/\\([()*])/g,'$1');
      if(match.index>last)parts.push(plain(text.slice(last,match.index)));
      if(validUrl(url))parts.push(<a key={key++} href={url} target="_blank" rel="noreferrer">{richInline(text.slice(match.index+1,labelEnd),depth+1,false,true,markdown)}</a>);
      else parts.push(plain(text.slice(match.index,end+1)));
      // Invalid complete links also fall back as one literal span, rather than
      // repeatedly parsing overlapping candidates within an invalid URL.
      last=end+1;pattern.lastIndex=last;continue;
    }
    if(match.index>last)parts.push(plain(text.slice(last,match.index)));
    const group=match.groups;
    if(match[0].startsWith('\\'))parts.push(plain(match[0]));
    else if(group.both)parts.push(<strong key={key++}><em>{richInline(group.both,depth+1,links,linkLabel,markdown,onReference)}</em></strong>);
    else if(group.bold)parts.push(<strong key={key++}>{richInline(group.bold,depth+1,links,linkLabel,markdown,onReference)}</strong>);
    else if(group.italic)parts.push(<em key={key++}>{richInline(group.italic,depth+1,links,linkLabel,markdown,onReference)}</em>);
    last=pattern.lastIndex;
  }
  if(last<text.length)parts.push(plain(text.slice(last)));return parts;
}

function safeRichBlocks(text,{markdown=false,onReference}={}) {
  const lines=String(text).split('\n'),blocks=[];let paragraph=[],list=[],quotes=[];
  const inline=line=>richInline(line,0,true,false,markdown,onReference);
  function flushParagraph(){if(paragraph.length){blocks.push(<p key={blocks.length}>{paragraph.map((line,index)=><React.Fragment key={index}>{index>0&&<br/>}{inline(line)}</React.Fragment>)}</p>);paragraph=[];}}
  function flushList(){if(list.length){blocks.push(<ul key={blocks.length}>{list.map((line,index)=>{const label=markdown&&/^([^：:*\[\]`]{1,12}：)\s*(.+)$/.exec(line);return <li key={index}>{label?<><strong>{label[1]}</strong>{inline(label[2])}</>:inline(line)}</li>;})}</ul>);list=[];}}
  function flushQuotes(){if(quotes.length){blocks.push(<blockquote key={blocks.length}>{quotes.map((line,index)=><React.Fragment key={index}>{index>0&&<br/>}{inline(line)}</React.Fragment>)}</blockquote>);quotes=[];}}
  for(const rawLine of lines){
    const line=markdown?rawLine.replace(/\r$/,''):rawLine;
    const heading=markdown&&/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    const quote=markdown&&/^ {0,3}>\s?(.*)$/.exec(line);
    if(heading){flushParagraph();flushList();flushQuotes();const Tag=`h${heading[1].length}`;blocks.push(<Tag key={blocks.length}>{inline(heading[2])}</Tag>);continue;}
    if(quote){flushParagraph();flushList();quotes.push(quote[1]);continue;}
    flushQuotes();
    const match=/^\s*[-*]\s+(.*)$/.exec(line);
    if(match){flushParagraph();list.push(match[1]);}else{flushList();if(markdown?!line.trim():!line){flushParagraph();if(!markdown)blocks.push(<p key={blocks.length}><br/></p>);}else paragraph.push(line);}
  }
  flushParagraph();flushList();flushQuotes();return blocks;
}

export const SafeRichBody=React.memo(function SafeRichBody({text='',className='',onReference}) {
  return text?<div className={`se-safe-rich ${className}`}>{safeRichBlocks(text,{markdown:true,onReference})}</div>:null;
});
