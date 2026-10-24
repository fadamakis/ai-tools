import { serveStdio } from './vendor.mjs';
import { createServer } from '../index.mjs';
serveStdio(() => createServer());
