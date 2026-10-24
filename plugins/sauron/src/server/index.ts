import { dataPath } from './data-path.mjs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SauronStore } from './store.js';
import { createServer } from './mcp.js';

const store = new SauronStore(dataPath());
serveStdio(() => createServer(store,fileURLToPath(new URL('../ui/index.html',import.meta.url))));
