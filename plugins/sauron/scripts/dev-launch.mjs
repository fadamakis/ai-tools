import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {existsSync,lstatSync,realpathSync} from 'node:fs';
import {devPaths,assertLocalPath,acquireDevRuntimeLock,currentBuild} from './dev-state.mjs';

const projectRoot=fileURLToPath(new URL('..',import.meta.url));
const paths=devPaths(projectRoot);
const release=acquireDevRuntimeLock(projectRoot);
process.once('exit',release);
process.once('SIGTERM',()=>process.exit(0));
process.once('SIGINT',()=>process.exit(0));
assertLocalPath(projectRoot,paths.database);
if(!existsSync(paths.database)||!lstatSync(paths.database).isFile())throw Error('Fixture database is missing. Run pnpm sauron:dev:setup.');
if(!process.env.ATTENTION_DB||realpathSync(process.env.ATTENTION_DB)!==realpathSync(paths.database))throw Error('Sauron Dev requires its dedicated fixture database. Run sauron:dev:setup.');
process.env.ATTENTION_DB=paths.database;
const current=currentBuild(projectRoot);
process.env.SAURON_DEV_BUILD_ID=current.buildId;
await import(pathToFileURL(join(current.build,'server/dev-runtime.js')).href);
