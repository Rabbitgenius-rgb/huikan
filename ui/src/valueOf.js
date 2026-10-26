export function valueOf(reply){if(reply?.ok===false)throw Object.assign(Error(reply.error?.message||'操作未完成'),{code:reply.error?.code});return reply?.ok===true?reply.data:reply;}
