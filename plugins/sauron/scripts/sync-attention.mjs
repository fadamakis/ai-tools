import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve, dirname, basename } from 'node:path';
import { dataPath } from '../src/server/data-path.mjs';
import { fileURLToPath } from 'node:url';

// Local MCP caller. It never reads a connector or starts the independent scanner.
const location=dirname(fileURLToPath(import.meta.url));
const root=resolve(location,basename(location)==='server'?'../..':'..');
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.length>250_000)throw Error('Request too large');}
const request=JSON.parse(input);
if(!request||!['list_attention','sync_attention','configure_attention_sync','get_attention_sync_receipt'].includes(request.name))throw Error('Use list_attention, sync_attention, configure_attention_sync or get_attention_sync_receipt');
const client=new Client({name:'sauron-dot-sync',version:'0.6.6'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve(root,'dist/server/index.js')],cwd:root,
    env:{...process.env,ATTENTION_DB:dataPath()},stderr:'pipe'}));
  const response=await client.callTool({name:request.name,arguments:request.arguments??{}});
  if(response.isError)throw Error(response.content?.find(item=>item.type==='text')?.text??'Sauron sync failed');
  if(!response.structuredContent?.storeId)throw Error('Invalid Sauron response');
  console.log(JSON.stringify(response.structuredContent,null,2));
}finally{await client.close();}
