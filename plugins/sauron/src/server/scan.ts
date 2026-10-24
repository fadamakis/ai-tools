import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StoreError, type SauronStore } from './store.js';

/** Starts one durable scan shared by every view and MCP process using this database. */
export function refreshAttention(store:SauronStore,automatic=false) {
  if(store.coordination().mode==='local_managed'&&store.sync()?.status==='running')return store.view();
  let scan;
  try{scan=store.beginScan(automatic);}catch(error){
    if(automatic&&error instanceof StoreError&&error.code==='dot_managed')return store.view();
    throw error;
  }
  const {run,started}=scan;
  if(started) {
    try {
      const child=spawn(process.execPath,[fileURLToPath(new URL('./scan-worker.js',import.meta.url)),store.path,run.id],
        {detached:true,stdio:'ignore',env:process.env});
      child.once('error',()=>store.failScan(run.id,'The source scanner could not start. Check the desktop runtime and try Refresh again.'));
      child.unref();
    }catch{store.failScan(run.id,'The source scanner could not start. Check the desktop runtime and try Refresh again.');}
  }
  return store.view();
}
