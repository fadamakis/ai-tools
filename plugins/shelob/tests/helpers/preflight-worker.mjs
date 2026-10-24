// Disposable-data worker for the browser handshake integration test. No data
// environment override or native UI connection is manufactured by this process.
import { serveStdio } from '../../server/dist/vendor.mjs';
import { createServer } from '../../server/index.mjs';
import { ReviewStore } from '../../server/store.mjs';
serveStdio(() => createServer({ store: new ReviewStore({ root: process.argv[2] }) }));
