import { z } from 'zod';
export const id = z.string().min(1).max(256);
const text = z.string().min(1).max(200000);
const integer = z.number().int().nonnegative();
export const selectionSchema = z.strictObject({text,start:integer,end:integer,prefix:z.string().max(128),suffix:z.string().max(128)}).refine(x=>x.end>x.start && x.end-x.start===x.text.length);
export const sourceSchema = z.strictObject({version:z.literal(1),provider:z.literal('deepseek-harness'),instanceId:id,sessionId:id,messageId:id,eventSeq:integer,turn:integer,sessionTitle:z.string().max(500),selection:selectionSchema.optional()});
const manualTopic = z.string().trim().min(1).max(40).refine(x=>!/[\x00-\x1f\x7f]/u.test(x),'主题不能包含控制字符');
export const captureSchema = z.strictObject({requestId:z.uuid(),text,title:z.string().max(500),externalSource:sourceSchema,manualTopic:manualTopic.optional()}).refine(x=>!x.externalSource.selection || x.text===x.externalSource.selection.text);
// Inputs and navigation commands remain Harness-only. Global deduplication can
// return the original excerpt first saved from Codex; retain that true source.
const codexSourceSchema = z.strictObject({version:z.literal(1),provider:z.literal('codex'),instanceId:z.string().regex(/^codex:[a-f0-9]{24}$/),sessionId:id.regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|thr_[A-Za-z0-9_-]{1,252})$/i),messageId:z.string().regex(/^capture-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),eventSeq:z.literal(0).refine(x=>!Object.is(x,-0)),turn:z.literal(0).refine(x=>!Object.is(x,-0)),sessionTitle:z.string().max(500)});
export const itemSchema = z.strictObject({id,title:z.string().max(500),text,savedAt:z.string(),due:z.boolean(),externalSource:z.union([sourceSchema,codexSourceSchema]),manualTopic:manualTopic.optional()});
const accepted = z.strictObject({accepted:z.boolean()});
export const methods = {
 info: {input:z.strictObject({}),output:z.strictObject({instanceId:id,version:z.string(),supported:z.boolean()})},
 publishContext:{input:z.strictObject({viewId:id,instanceId:id,sessionId:z.string().max(256),sessionTitle:z.string().max(500),focused:z.boolean(),supported:z.boolean(),version:z.string().max(64),contextSeq:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),focusEpoch:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).refine(x=>!x.focused||x.focusEpoch>0),output:z.strictObject({accepted:z.boolean(),contextProtocol:z.literal(2)})},
 capture:{input:captureSchema,output:z.strictObject({requestId:z.uuid(),status:z.enum(['saved','pending']),item:itemSchema.optional(),error:z.strictObject({code:z.string(),message:z.string()}).optional()})},
 pollCommands:{input:z.strictObject({viewId:id,instanceId:id}),output:z.strictObject({commands:z.array(z.strictObject({id,kind:z.literal('reveal'),source:sourceSchema}))})},
 navigationResult:{input:z.strictObject({viewId:id,id,ok:z.boolean(),code:z.string().optional(),message:z.string().optional()}),output:accepted},
};
