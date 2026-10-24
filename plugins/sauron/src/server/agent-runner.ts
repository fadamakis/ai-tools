import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveCodexCli} from './codex-cli.mjs';
import {localPolicyArgs,minimalAgentEnv} from './local-policy.js';

export class AgentError extends Error {
  constructor(readonly code:'timeout'|'runtime'|'output'|'budget'|'policy'){super(code);}
}
export async function runReadOnlyAgent(prompt:string,schema:unknown,options:{cli?:string;timeoutMs?:number;model?:string}={}) {
  const dir=await mkdtemp(join(tmpdir(),'sauron-local-'));
  await chmod(dir,0o700);
  try{
    const schemaPath=join(dir,'schema.json'),resultPath=join(dir,'result.json');
    await writeFile(schemaPath,JSON.stringify(schema),{mode:0o600});
    await writeFile(resultPath,'',{mode:0o600});
    const cli=options.cli??process.env.SAURON_CODEX_BIN??resolveCodexCli();
    const policy=localPolicyArgs();
    // CLI inventory is configuration-only. Abort if a newly installed plugin
    // would add a local server not covered by the explicit deny list.
    let servers:{enabled?:boolean}[];
    try{servers=JSON.parse(execFileSync(cli,['mcp','list','--json',...policy],{encoding:'utf8',timeout:20000,env:minimalAgentEnv(),stdio:['ignore','pipe','ignore'],maxBuffer:1_000_000}));}
    catch{throw new AgentError('policy');}
    if(!Array.isArray(servers)||servers.some(server=>server.enabled!==false))throw new AgentError('policy');
    const args=['--no-daemon','exec','--ephemeral','--ignore-user-config','--strict-config','--sandbox','read-only','--skip-git-repo-check',
      '--cd',dir,'--json','--output-schema',schemaPath,'--output-last-message',resultPath,
      ...policy,...(options.model?['--model',options.model]:[]),'-'];
    const observedTools:string[]=[];
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(cli,args,{detached:true,stdio:['pipe','pipe','pipe'],env:minimalAgentEnv()});
      let settled=false,buffer='';
      const stop=()=>{try{process.kill(-child.pid!,'SIGTERM');}catch{child.kill('SIGTERM');}};
      const finish=(error?:AgentError)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
      const timer=setTimeout(()=>{stop();finish(new AgentError('timeout'));},options.timeoutMs??10*60_000);
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString();
        if(buffer.length>1_000_000){stop();finish(new AgentError('output'));return;}
        for(;;){
          const index=buffer.indexOf('\n');if(index<0)break;
          const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
          try{
            const event=JSON.parse(line);
            if(event.type==='item.started'&&event.item?.type==='mcp_tool_call'){
              observedTools.push(`${event.item.server}:${event.item.tool}`);
              if(observedTools.length>60){stop();finish(new AgentError('budget'));}
            }
          }catch{/* Runtime text is never persisted or returned to the UI. */}
        }
      });
      child.stderr.on('data',()=>{});
      child.once('error',()=>finish(new AgentError('runtime')));
      child.once('close',code=>finish(code===0?undefined:new AgentError('runtime')));
      child.stdin.on('error',()=>{});child.stdin.end(prompt);
    });
    const payload=await readFile(resultPath,'utf8');
    if(payload.length>256_000)throw new AgentError('output');
    try{return {output:JSON.parse(payload),observedTools};}catch{throw new AgentError('output');}
  }finally{await rm(dir,{recursive:true,force:true});}
}
