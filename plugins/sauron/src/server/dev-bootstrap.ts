import {SauronStore} from './store.js';
import {CodexChatReader,type ChatReader} from './chat-reader.js';
import {runOrganisationReview,type ProposalGenerator} from './organisation-review.js';
import {devBuildId} from '../shared/build-info.js';
import {devPaths,assertLocalPath} from '../../scripts/dev-state.mjs';
import {inspectDevDatabase,replaceDevDatabase} from '../../scripts/dev-archive.mjs';

type Options={root:string;buildId:string;expectedStoreId:string;fresh:boolean;log:(message:string)=>void};
type Dependencies={reader?:()=>ChatReader;generate?:ProposalGenerator;move?:typeof import('node:fs').renameSync};
export async function bootstrapDev(options:Options,dependencies:Dependencies={}){
  const {root,buildId,expectedStoreId,fresh,log}=options;
  if(!devBuildId||buildId!==devBuildId)throw Error('Selected Dev build identity does not match its bootstrap runtime. Rebuild Sauron Dev.');
  const paths=devPaths(root);assertLocalPath(root,paths.database);
  const inspected=inspectDevDatabase(root);
  if(inspected.storeId!==expectedStoreId)throw Error('Dev store identity changed. Retry against the current store.');
  if(!fresh&&inspected.review?.proposal?.status==='pending')throw Error('Review or dismiss the pending proposal in Sauron Dev first. Use --fresh only to archive and clear the whole Dev store.');
  log(`Sauron Dev real local-history bootstrap · build ${buildId}`);
  log(`Database: ${paths.database}`);
  log('Checking read-only local Codex chat access. Remote hosts and ChatGPT history are not covered.');
  const abort=new AbortController();
  let reader:ChatReader|undefined,store:SauronStore|undefined,archive:string|undefined;
  const stop=()=>{abort.abort(Error('Bootstrap interrupted. Resume with pnpm sauron:dev:bootstrap.'));reader?.close();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    reader=(dependencies.reader??(()=>new CodexChatReader()))();
    const close=reader.close.bind(reader);let closed=false;
    reader.close=()=>{if(!closed){closed=true;close();}};
    await reader.probe();abort.signal.throwIfAborted();
    if(inspectDevDatabase(root).storeId!==expectedStoreId)throw Error('Dev store identity changed. Original data is unchanged.');
    if(fresh){
      archive=replaceDevDatabase(root,path=>{const empty=new SauronStore(path);empty.close();},{expectedStoreId,move:dependencies.move});
      log(`Previous Dev store archived at ${archive}`);
    }
    store=new SauronStore(paths.database);
    if(!fresh&&store.storeId!==expectedStoreId)throw Error('Dev store identity changed.');
    const {run,started}=store.beginReview('bootstrap','local_history');
    if(!started)throw Error('A review is already running or has a pending proposal. Review its status in Sauron Dev before retrying.');
    log(`Review window: ${run.from} through ${run.through}`);
    await runOrganisationReview(store,run.id,run.leaseId,{reader,readerVerified:true,generate:dependencies.generate,signal:abort.signal,onProgress:current=>log(`Progress: ${Object.keys(current.seen).length} chats reviewed · ${current.stage} · ${current.changes.length} proposed changes`)});
    const state=store.reviews.state(),status=state.run!.status;
    const proposal=state.proposal?.status==='pending'&&state.proposal.id===run.id?state.proposal:null;
    log(`Review ${status}: ${Object.keys(state.run!.seen).length} chats reviewed · ${proposal?.changes.length??state.run!.changes.length} proposed changes · ${state.run!.errors.length} coverage issues`);
    log(status==='completed'?(proposal?'Open Sauron Dev to review and accept the proposal.':'Review complete. No organisation changes proposed.'):'Progress is saved. Resume with pnpm sauron:dev:bootstrap; review or dismiss any pending proposal first.');
    return {status,storeId:store.storeId,runId:run.id,archive,proposalId:proposal?.id??null};
  }catch(error){
    if(archive)log(`Fresh Dev store retained; previous data is archived at ${archive}. Resume with pnpm sauron:dev:bootstrap.`);
    throw error;
  }finally{reader?.close();store?.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
