import {existsSync} from 'node:fs';
import {SauronStore} from '../src/server/store.js';
import {triggerOrganisationReview} from '../src/server/organisation-trigger.js';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--database'||args[2]!=='--expected-store-id'||!existsSync(args[1]))throw Error('An existing database and expected store ID are required.');
const store=new SauronStore(args[1]);
try{if(store.storeId!==args[3])throw Error('Store identity changed.');triggerOrganisationReview(store,{expectedStoreId:args[3],kind:'daily',reason:'timer'});}finally{store.close();}
