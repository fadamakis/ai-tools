import {existsSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {dataPath} from '../src/server/data-path.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--expected-store-id'||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(args[1]))throw Error('Use --expected-store-id UUID for the existing Sauron store.');
const path=dataPath();if(!existsSync(path))throw Error('The existing Sauron database is unavailable. No new store was created.');
const location=dirname(fileURLToPath(import.meta.url));
const root=resolve(location,basename(location)==='server'?'../..':'..');
const actualIndex=resolve(root,'dist/server/index.js');
const client=new Client({name:'sauron-local-scheduler',version:'1'});
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[actualIndex],env:{...process.env,ATTENTION_DB:path},stderr:'pipe'}));
 const result=await client.callTool({name:'check_local_attention',arguments:{expectedStoreId:args[1],reason:'timer'}});
 if(result.isError)throw Error('Local Sauron check could not start. Read Sauron diagnostics.');
 const view=result.structuredContent;
 console.log(JSON.stringify({storeId:view.storeId,mode:view.coordination?.mode,status:view.sync?.status,local:view.local?{blocked:view.local.blocked,nextAttemptAt:view.local.nextAttemptAt}:undefined}));
}finally{await client.close();}
