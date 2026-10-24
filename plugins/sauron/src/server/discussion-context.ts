import {z} from 'zod';

// Read per-call host metadata, never a process's parent thread or an ID guessed
// by the model. These Codex keys match the bundled app-tools MCP integration.
export function discussionConversationUrl(meta:Record<string,unknown>|undefined):string|undefined {
  if(!meta)return;
  const id=(keys:string[])=>keys.map(key=>meta[key]).find((value):value is string=>typeof value==='string'&&z.uuid().safeParse(value).success);
  const conversation=id(['openai/conversationId','openai/conversation_id','chatgptConversationId','chatgpt_conversation_id']);
  if(conversation)return `https://chatgpt.com/c/${conversation}`;
  let thread=id(['openai/threadId','openai/thread_id','codexThreadId','codex_thread_id','threadId','thread_id']);
  if(!thread){
    let turn=meta['x-codex-turn-metadata'];
    if(typeof turn==='string'){try{turn=JSON.parse(turn);}catch{return;}}
    if(turn&&typeof turn==='object'&&'thread_id' in turn&&z.uuid().safeParse(turn.thread_id).success)thread=turn.thread_id as string;
    const nested=meta.thread;
    if(!thread&&nested&&typeof nested==='object'&&'id' in nested&&z.uuid().safeParse(nested.id).success)thread=nested.id as string;
  }
  return thread?`codex://threads/${thread}`:undefined;
}
