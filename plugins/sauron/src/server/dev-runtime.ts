import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {fileURLToPath} from 'node:url';
import {SauronStore} from './store.js';
import {createServer} from './mcp.js';
import {invokeFixture} from './dev-fixtures.js';
import {devBuildId} from '../shared/build-info.js';

if(!devBuildId||process.env.SAURON_DEV_BUILD_ID!==devBuildId||!process.env.ATTENTION_DB)throw Error('Start Sauron Dev using its generated adapter.');
const store=new SauronStore(process.env.ATTENTION_DB);
process.once('exit',()=>store.close());
process.stdin.once('end',()=>process.exit(0));
console.error(`Sauron Dev fixtures · build ${devBuildId}`);
serveStdio(()=>createServer(store,fileURLToPath(new URL('../ui/index.html',import.meta.url)),{invoke:invokeFixture,buildId:devBuildId,runtimeRoot:fileURLToPath(new URL('..',import.meta.url))}));
