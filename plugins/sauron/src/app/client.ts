import {PanelError,readErrorDetail,errorDetail} from '../shared/errors.js';
import {diagnostics,correlation,requestCorrelation,actionForTool} from './diagnostics.js';
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { discussionMessage } from './discussion.js';
import type { Result, Task } from '../shared/contracts.js';
import {devBuildId} from '../shared/build-info.js';

function checkedResult(data:Result&{dev?:{buildId:string}}):Result {
  if(devBuildId&&data.dev?.buildId!==devBuildId)throw new PanelError({category:'build_mismatch',outcome:'unconfirmed'});
  return data;
}

export type Client = {call:(name:string,args?:unknown)=>Promise<Result>; open:(url:string)=>Promise<void>; mode:string; discuss?:(task:Task,storeId:string)=>Promise<void>};
async function connectClient(onView:(view:Result)=>void):Promise<Client> {
  if(window.parent === window) {
    applyDocumentTheme(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    return {
      mode:'Local preview',
      call:async(name,args={})=>{
        const response=await fetch('/api/tool',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({name,arguments:args})});
        const data=await response.json();
        if(!response.ok || data.error)throw new PanelError(readErrorDetail(data.errorDetail));
        return checkedResult(data);
      },
      open:async url=>{window.open(url,'_blank','noopener,noreferrer');},
    };
  }
  const app=new App({name:'Sauron',version:'0.6.6'});
  const extensions=new OpenAIExtensions(app);
  app.ontoolresult=result=>{
    if(result.structuredContent && 'items' in result.structuredContent)
      onView(checkedResult(result.structuredContent as Result));
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
      throw new PanelError({category:'unavailable',outcome:'rejected'});
  }
  return {mode:'MCP app',...(extensions.message?{discuss:async(task:Task,storeId:string)=>{
    const result=await extensions.message!.send({role:'user',content:[{type:'text',text:discussionMessage(task,storeId)}],_meta:{'openai/message':{target:'new',send:true}}});
    if(result.isError)throw Error('The discussion could not be opened.');
  }}:{}),call:async(name,args={})=>{
    const result=await app.callServerTool({name,arguments:args as Record<string,unknown>});
    if(result.isError)throw new PanelError(readErrorDetail((result.structuredContent as {error?:unknown}|undefined)?.error));
    if(!result.structuredContent || !('items' in result.structuredContent))throw new PanelError({category:'connection',outcome:'unconfirmed'});
    return checkedResult(result.structuredContent as Result);
  },open:async url=>{await app.openLink({url});}};
}

export async function connect(onView:(view:Result)=>void):Promise<Client>{
  try{
    const client=await connectClient(onView);
    const call=client.call;
    client.call=async(name,args={})=>{
      const action=actionForTool(name);
      const id=requestCorrelation(action,args);
      if(name!=='list_attention'&&name!=='get_slack_reply')diagnostics.record(action,'sent',id);
      try{const result=await call(name,args);if(diagnostics.snapshot().active.some(e=>e.action===action)||name!=='list_attention'&&name!=='get_slack_reply')diagnostics.record(action,'saved',id,'unknown','saved');return result;}
      catch(error){const detail=errorDetail(error);diagnostics.record(action,'failed',id,detail.category,detail.outcome);throw error instanceof PanelError?error:new PanelError(detail);}
    };
    const open=client.open;
    client.open=async url=>{const id=correlation('open_link');try{await open(url);diagnostics.record('open_link','saved',id,'unknown','saved');}catch{diagnostics.record('open_link','failed',id);throw new PanelError({category:'unavailable',outcome:'unconfirmed'});}};
    if(client.discuss){const discuss=client.discuss;client.discuss=async(task,storeId)=>{const id=correlation('open_chat');try{await discuss(task,storeId);diagnostics.record('open_chat','saved',id,'unknown','saved');}catch{diagnostics.record('open_chat','failed',id);throw new PanelError({category:'unavailable',outcome:'unconfirmed'});}};}
    diagnostics.record('connection','saved',correlation('connection'),'unknown','saved');
    return client;
  }catch(error){const detail=errorDetail(error);diagnostics.record('connection','failed',correlation('connection'),detail.category,detail.outcome);throw new PanelError(detail);}
}
