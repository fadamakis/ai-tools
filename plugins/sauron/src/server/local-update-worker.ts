import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {SauronStore} from './store.js';
import {runLocalUpdate} from './local-update.js';
export {runReadOnlyAgent} from './agent-runner.js';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2]&&process.argv[3]) {
  // Fail closed: never create a new active store because a path disappeared.
  if(!existsSync(process.argv[2]))throw Error('The existing Sauron database is unavailable.');
  const store=new SauronStore(process.argv[2]);
  try{await runLocalUpdate(store,process.argv[3]);}finally{store.close();}
}
