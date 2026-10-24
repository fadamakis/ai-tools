import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {products} from './release.mjs';
export async function smokePackages(root) {
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-clean-install-')),results=[];
 try {
  for(const name of products) {
   const source=path.resolve(root,'plugins',name), plugin=path.join(temporary,name);
   fs.cpSync(source,plugin,{recursive:true});
   const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'),'utf8'));
   const config=JSON.parse(fs.readFileSync(path.join(plugin,'mcp.json'),'utf8')).mcpServers[name];
   const client=new Client({name:'ai-tools-clean-install',version:'1.0.0'});
   try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:config.args.map(arg=>arg.replace('${PLUGIN_ROOT}',plugin)),cwd:plugin,env:{PATH:process.env.PATH,HOME:temporary,SHELOB_DATA_DIR:path.join(temporary,'shelob-data'),WORKBENCH_PREVIEW_DATA_DIR:path.join(temporary,'workbench-data'),ATTENTION_DB:path.join(temporary,'sauron-data','attention.sqlite')},stderr:'pipe'}),{timeout:15000});
    const tools=await client.listTools();
    const method={shelob:'shelob.rules',sauron:'list_attention',workbench:'workbench.list'}[name];
    const result=await client.callTool({name:method,arguments:{}});if(result.isError) throw Error(`${name}: read-only call failed`);
    const resources=await client.listResources();
    if(!resources.resources.length) throw Error(`${name}: no UI resource`);
    const ui=await client.readResource({uri:resources.resources[0].uri});
    if(!ui.contents.some(content=>content.text?.includes('<!doctype html>')||content.text?.includes('<!DOCTYPE html>'))) throw Error(`${name}: UI missing`);
    const server=client.getServerVersion();if(server.version!==manifest.version) throw Error(`${name}: server version ${server.version} differs from ${manifest.version}`);
    results.push({name,version:manifest.version,tools:tools.tools.length,status:'passed'});
   } finally {await client.close();}
  }
  return results;
 } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) console.log(JSON.stringify(await smokePackages(process.argv[2]||'dist/release'),null,2));
