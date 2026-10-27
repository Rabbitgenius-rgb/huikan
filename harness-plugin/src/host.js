import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import * as typertProtocol from '@deepseek-ai/dsh-typert-protocol';
import { methods } from './schemas.js';
import { SUPPORTED_VERSIONS } from './core.js';
import { generateTopics } from './topic-model.js';
import rpc from './private-rpc.cjs';
import discovery from './connection-discovery.cjs';

export const name='mengcang-recall';
export const inject=['typert'];
const packageName='@mengcang/harness-recall';
const {TypertRemoteService,RemoteError}=typertProtocol;
const require=createRequire(import.meta.url);
function codec(schema, label) { return {mode:'strict',typeSymbol:packageName+'#'+label,create:()=>schema,get jsonSchema(){return z.toJSONSchema(schema,{unrepresentable:'any'});}}; }
const remoteSpec={package:packageName,methods:Object.fromEntries(Object.entries(methods).map(([method,schema])=>['recall/'+method,{service:'recallBridge',description:'Local manual recall '+method,invocation:{kind:'direct'},parameters:[{name:'request',wire:'request',source:'json',codec:codec(schema.input,method+'Input'),strictCodec:codec(schema.input,method+'Input')}],result:codec(schema.output,method+'Result'),sourceLocation:{file:'src/host.js',line:1,column:1}}]))};
// 0.2.0-rc.2 registers generated descriptors directly; the lazy info factory only
// exists in 0.2.1-rc.3. Both use the same strict Registry invocation contract.
export const remoteInfo=typeof typertProtocol.createTypertRemoteInfo==='function'
 ? typertProtocol.createTypertRemoteInfo(remoteSpec,z)
 : {package:packageName,descriptors:Object.entries(remoteSpec.methods).map(([endpoint,definition])=>({...definition,id:packageName+'#'+endpoint,namespace:'recall',method:endpoint.slice('recall/'.length)}))};

export function identity(config={}) {
 const version=require('@deepseek-ai/dsh-typert-protocol/package.json').version;
 const instanceId=config.instanceId || process.env.MENGCANG_RECALL_INSTANCE_ID || 'dsh-'+createHash('sha256').update(resolve(process.env.DSH_HOME || join(homedir(),'.dsh'))).digest('hex').slice(0,32);
 methods.info.output.shape.instanceId.parse(instanceId);
 return {instanceId,version,supported:SUPPORTED_VERSIONS.includes(version)};
}
export class RecallBridge extends TypertRemoteService {
 constructor(ctx, config={}) { super(ctx,'recallBridge',{namespace:'recall'});this.identity=identity(config);this.config=config; }
 info(request) {methods.info.input.parse(request);return this.identity;}
 async forward(method,request) {
  methods[method].input.parse(request);
  if(!this.identity.supported)throw new RemoteError('RECALL_UNSUPPORTED','当前 Harness 版本尚未适配。');
  const source=method==='capture'?request.externalSource:request;
  if(source.instanceId && source.instanceId!==this.identity.instanceId)throw new RemoteError('RECALL_INSTANCE','来源实例不匹配。');
  let result;
  try {result=await rpc.callPrivate({directory:await discovery.resolveBridgeDirectory({config:this.config}),service:'sticky',method,params:request,timeoutMs:method==='capture'?10000:3000});}
  catch(error){throw new RemoteError('RECALL_BRIDGE',error.code==='UNAVAILABLE'?'回看浮窗尚未连接。':String(error.message || '本地回看连接失败。').slice(0,300));}
  if(method==='publishContext'&&result?.contextProtocol!==2)throw new RemoteError('RECALL_CONTEXT_PROTOCOL','请同时更新回看插件与浮窗，并重新加载 Harness 页面。');
  return methods[method].output.parse(result);
 }
 publishContext(request){return this.forward('publishContext',request);}
 capture(request){return this.forward('capture',request);}
 pollCommands(request){return this.forward('pollCommands',request);}
 navigationResult(request){return this.forward('navigationResult',request);}
}
export function apply(ctx,config={}){
 ctx.typert.register({package:packageName,face:'host',schemas:[],invocations:remoteInfo.descriptors,model:{services:[],events:[],objects:[]}});
 ctx.plugin(RecallBridge,config);
 // Optional model integration never blocks capture, context follow or source navigation.
 ctx.inject(['llm','agentDefaultModel'], modelContext=>{
  let closed=false,server;
  const own=identity(config);let directory='',refreshing=null;
  const refresh=()=>{if(closed||refreshing)return refreshing;
   refreshing=(async()=>{const next=await discovery.resolveBridgeDirectory({config});if(next===directory&&server)return;await server?.close();server=null;directory=next;
    const candidate=await rpc.startPrivateServer({directory,service:'harness-topics',handlers:{generate:async request=>{if(request?.instanceId!==own.instanceId)throw Error('主题整理来源实例不匹配');return generateTopics(modelContext,request);}}});
    if(closed)await candidate.close();else server=candidate;
   })().catch(()=>{}).finally(()=>{refreshing=null;});return refreshing;
  };
  void refresh();const timer=setInterval(()=>void refresh(),2000);timer.unref?.();
  modelContext.effect(()=>async()=>{closed=true;clearInterval(timer);await refreshing;await server?.close();});
 });
}
