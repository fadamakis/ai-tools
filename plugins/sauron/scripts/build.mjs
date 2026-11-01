import { writeNotices } from '../../../scripts/notices.mjs';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { resolve, join } from 'node:path';
import {assertLocalPath} from './dev-state.mjs';

const output=resolve(process.env.SAURON_BUILD_DIR || 'dist');
const devBuildId=process.env.SAURON_DEV_BUILD_ID || '';
if(devBuildId?(!/^[a-zA-Z0-9-]+$/.test(devBuildId)||output!==resolve('.data/sauron-dev/builds',devBuildId)):output!==resolve('dist'))throw Error('Use sauron:dev:build for isolated dev output, or the default dist for a production build.');
assertLocalPath(process.cwd(),output);
const definitions={__SAURON_DEV_BUILD_ID__:JSON.stringify(devBuildId),__SAURON_PLUGIN_REFERENCE__:JSON.stringify(devBuildId?'sauron-dev@sauron-dev':'sauron@ai-tools')};
await rm(output,{recursive:true,force:true});
await mkdir(join(output,'ui'),{recursive:true});
const foundation=await postcss([tailwind({optimize:true})]).process(await readFile('src/app/inbox.css','utf8'),{from:'src/app/inbox.css'});
// Math is not rendered by this app. Keep its SDK controls on host fonts offline.
foundation.root.walkAtRules('font-face',rule=>{if(/font-family:\s*KaTeX/.test(rule.toString()))rule.remove();});
const ui=await build({entryPoints:['src/app/main.tsx'],bundle:true,write:false,outfile:join(output,'ui/app.js'),
  metafile:true,platform:'browser',format:'iife',target:'es2022',minify:true,
  define:{...definitions,'process.env.NODE_ENV':'"production"',__SAURON_VERSION__:JSON.stringify(JSON.parse(await readFile('plugin.json','utf8')).version)},loader:{'.png':'dataurl'}});
const hostStyles=await readFile(new URL(import.meta.resolve('@openai/mcp-extensions/app/styles.css')),'utf8');
const componentCss=ui.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'';
const css=(hostStyles+'\n'+foundation.root.toString()+'\n'+componentCss).replaceAll('</style','<\\/style');
const script=ui.outputFiles.find(file=>file.path.endsWith('.js')).text.replaceAll('</script','<\\/script');
await writeFile(join(output,'ui/index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sauron</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`);
const server=await build({metafile:true,entryPoints:{...(devBuildId?{'dev-runtime':'src/server/dev-runtime.ts','dev-fixtures':'src/server/dev-fixtures.ts'}:{}),'index-verification':'src/server/index-verification.ts',index:'src/server/index.ts',preview:'src/server/preview.ts','scan-worker':'src/server/scan-worker.ts','local-update-worker':'src/server/local-update-worker.ts','check-local-attention':'scripts/check-local-attention.mjs','reply-worker':'src/server/reply-worker.ts','sync-attention':'scripts/sync-attention.mjs','check-attention':'scripts/check-attention.mjs'},bundle:true,define:definitions,
  banner:{js:"import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);"},outdir:join(output,'server'),format:'esm',platform:'node',target:'node22'});

writeNotices([ui,server],devBuildId?join(output,'THIRD_PARTY_NOTICES.md'):'THIRD_PARTY_NOTICES.md');
if(devBuildId){
  await mkdir(join(output,'assets'),{recursive:true});
  await writeFile(join(output,'assets/sidebar-icon.svg'),await readFile('assets/sidebar-icon.svg'));
  await writeFile(join(output,'plugin.json'),await readFile('plugin.json'));
}
