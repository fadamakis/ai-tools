import {SauronStore} from './store.js';
import {runOrganisationReview} from './organisation-review.js';
const [path,storeId,runId,leaseId]=process.argv.slice(2);
if(!path||!storeId||!runId||!leaseId)throw Error('An existing store and review lease are required.');
const store=new SauronStore(path);
try{if(store.storeId!==storeId)throw Error('Store identity changed.');await runOrganisationReview(store,runId,leaseId);}catch{store.failReview(runId,leaseId,'The organisation runtime is unavailable. Check local chat access and resume.');}finally{store.close();}
