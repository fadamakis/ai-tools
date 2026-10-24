import { writeNotices } from '../../../scripts/notices.mjs';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

await rm('dist',{recursive:true,force:true});
await mkdir('dist/ui',{recursive:true});
const foundation=await postcss([tailwind({optimize:true})]).process(await readFile('src/app/inbox.css','utf8'),{from:'src/app/inbox.css'});
// Math is not rendered by this app. Keep its SDK controls on host fonts offline.
foundation.root.walkAtRules('font-face',rule=>{if(/font-family:\s*KaTeX/.test(rule.toString()))rule.remove();});
const ui=await build({entryPoints:['src/app/main.tsx'],bundle:true,write:false,outfile:'dist/ui/app.js',
  metafile:true,platform:'browser',format:'iife',target:'es2022',minify:true,
  define:{'process.env.NODE_ENV':'"production"',__SAURON_VERSION__:JSON.stringify(JSON.parse(await readFile('plugin.json','utf8')).version)},loader:{'.png':'dataurl'}});
const hostStyles=await readFile(new URL(import.meta.resolve('@openai/mcp-extensions/app/styles.css')),'utf8');
const componentCss=ui.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'';
const css=(hostStyles+'\n'+foundation.root.toString()+'\n'+componentCss).replaceAll('</style','<\\/style');
const script=ui.outputFiles.find(file=>file.path.endsWith('.js')).text.replaceAll('</script','<\\/script');
await writeFile('dist/ui/index.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sauron</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`);
const server=await build({metafile:true,entryPoints:{'index-verification':'src/server/index-verification.ts',index:'src/server/index.ts',preview:'src/server/preview.ts','scan-worker':'src/server/scan-worker.ts','local-update-worker':'src/server/local-update-worker.ts','check-local-attention':'scripts/check-local-attention.mjs','reply-worker':'src/server/reply-worker.ts','sync-attention':'scripts/sync-attention.mjs','check-attention':'scripts/check-attention.mjs'},bundle:true,
  banner:{js:"import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);"},outdir:'dist/server',format:'esm',platform:'node',target:'node22'});

writeNotices([ui,server],'THIRD_PARTY_NOTICES.md');
