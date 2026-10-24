import { dataPath } from './data-path.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SauronStore } from './store.js';
import { invoke } from './service.js';

const port=Number(process.env.PORT ?? 4318);
const origin=`http://127.0.0.1:${port}`;
const store=new SauronStore(dataPath());
const html=readFileSync(fileURLToPath(new URL('../ui/index.html',import.meta.url)));
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.headers.host !== `127.0.0.1:${port}`) {res.writeHead(403).end();return;}
  if(req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type','text/html;charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.end(html);return;
  }
  if(req.method !== 'POST' || req.url !== '/api/tool') {res.writeHead(404).end();return;}
  if((req.headers.origin && req.headers.origin !== origin) || req.headers['content-type'] !== 'application/json') {
    res.writeHead(403).end();return;
  }
  res.setHeader('Content-Type','application/json');
  try {
    let body='';
    for await(const chunk of req) {body+=chunk; if(body.length>32_768) throw Error('Request too large');}
    const {name, arguments:args}=JSON.parse(body);
    res.end(JSON.stringify(invoke(store,name,args)));
  } catch(error) {res.writeHead(400).end(JSON.stringify({error:error instanceof Error? error.message:'Request failed'}));}
});
server.listen(port,'127.0.0.1',()=>console.error(`Sauron preview: ${origin}`));
function close(){server.close(()=>{store.close();process.exit(0);});}
process.on('SIGTERM',close);process.on('SIGINT',close);
