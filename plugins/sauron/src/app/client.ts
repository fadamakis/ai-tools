import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { discussionMessage } from './discussion.js';
import type { Result, Task } from '../shared/contracts.js';

export type Client = {call:(name:string,args?:unknown)=>Promise<Result>; open:(url:string)=>Promise<void>; mode:string; discuss?:(task:Task,storeId:string)=>Promise<void>};
export async function connect(onView:(view:Result)=>void):Promise<Client> {
  if(window.parent === window) return {
    mode:'Local preview',
    call:async(name,args={})=>{
      const response=await fetch('/api/tool',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,arguments:args})});
      const data=await response.json();
      if(!response.ok || data.error)throw Error(data.error ?? 'Request failed');
      return data;
    },
    open:async url=>{window.open(url,'_blank','noopener,noreferrer');},
  };
  const app=new App({name:'Sauron',version:'0.6.6'});
  const extensions=new OpenAIExtensions(app);
  app.ontoolresult=result=>{
    if(result.structuredContent && 'items' in result.structuredContent)
      onView(result.structuredContent as Result);
  };
  const style=(context:ReturnType<App['getHostContext']>)=>{
    if(context?.theme)applyDocumentTheme(context.theme);
    if(context?.styles?.variables)applyHostStyleVariables(context.styles.variables);
    const insets=context?.safeAreaInsets;
    if(insets)for(const key of ['top','right','bottom','left'] as const)
      document.documentElement.style.setProperty(`--safe-${key}`,`${insets[key]}px`);
  };
  app.onhostcontextchanged=style;
  await app.connect();style(app.getHostContext());
  const host=app.getHostVersion();
  // Host rendering itself must still be tested in the actual desktop app.
  if(host?.version && /codex|chatgpt/i.test(host.name)) {
    const parts=host.version.split('.').map(Number);
    if(parts.length>=3 && parts.every(Number.isFinite) &&
      (parts[0]<26 || (parts[0]===26 && (parts[1]<928 || (parts[1]===928 && parts[2]<20710)))))
      throw Error('Update your desktop app to use the Sauron entrypoint.');
  }
  return {mode:'MCP app',...(extensions.message?{discuss:async(task:Task,storeId:string)=>{
    const result=await extensions.message!.send({role:'user',content:[{type:'text',text:discussionMessage(task,storeId)}],_meta:{'openai/message':{target:'new',send:true}}});
    if(result.isError)throw Error('The discussion could not be opened.');
  }}:{}),call:async(name,args={})=>{
    const result=await app.callServerTool({name,arguments:args as Record<string,unknown>});
    if(result.isError)throw Error(result.content?.find(v=>v.type==='text')?.text ?? 'Save failed');
    if(!result.structuredContent || !('items' in result.structuredContent))throw Error('Invalid server response');
    return result.structuredContent as Result;
  },open:async url=>{await app.openLink({url});}};
}
