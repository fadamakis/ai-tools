import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { writeNotices } from './notices.mjs';
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(workspace, 'plugins/shelob');
const serverOut = path.join(plugin, 'server/dist'), appOut = path.join(plugin, 'app/dist'), reportOut=path.join(plugin,'assets/dist');
for(const directory of [serverOut,appOut,reportOut])fs.mkdirSync(directory,{recursive:true});
const version=JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'),'utf8')).version;
const vendor = await build({ stdin: { contents: `export { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'; export { serveStdio } from '@modelcontextprotocol/server/stdio'; export { OpenAIExtensions } from '@openai/mcp-extensions/server'; export { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'; export { z } from 'zod';`, resolveDir: workspace },
  bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: path.join(serverOut, 'vendor.mjs'), metafile: true,
  banner: { js: "import { createRequire as __shelobCreateRequire } from 'node:module'; const require = __shelobCreateRequire(import.meta.url);" }, legalComments: 'inline' });
fs.writeFileSync(path.join(serverOut, 'index.mjs'), "import { serveStdio } from './vendor.mjs';\nimport { createServer } from '../index.mjs';\nserveStdio(() => createServer());\n");
const common={bundle:true,target:'es2022',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,legalComments:'inline',metafile:true,loader:{'.png':'dataurl'},define:{'process.env.NODE_ENV':'"production"',__SHELOB_VERSION__:JSON.stringify(version)}};
const app = await build({...common,entryPoints:[path.join(plugin,'app/main.jsx')],platform:'browser',format:'iife',outfile:path.join(appOut,'app.js')});
const exported=await build({...common,entryPoints:[path.join(plugin,'app/export-client.jsx')],platform:'browser',format:'iife',outfile:path.join(reportOut,'export-client.js')});
const rendered=await build({...common,entryPoints:[path.join(plugin,'app/export-server.jsx')],platform:'node',target:'node22',format:'esm',outfile:path.join(reportOut,'report-server.mjs'),banner:{js:"import { createRequire as __reportRequire } from 'node:module'; const require = __reportRequire(import.meta.url);"}});
const foundation=await postcss([tailwind({optimize:true})]).process(fs.readFileSync(path.join(plugin,'app/app.css'),'utf8'),{from:path.join(plugin,'app/app.css')});
// SDK's global CSS includes remote KaTeX faces. Neither product renders math;
// retain host typography and keep the MCP app and saved export fully offline.
foundation.root.walkAtRules('font-face',rule=>{if(/font-family:\s*KaTeX/.test(rule.toString()))rule.remove();});
const foundationCss=foundation.root.toString();
const hostStyles=fs.readFileSync(fileURLToPath(import.meta.resolve('@openai/mcp-extensions/app/styles.css')),'utf8');
const script = fs.readFileSync(path.join(appOut, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const componentCss=fs.readFileSync(path.join(appOut,'app.css'),'utf8');
const css=(hostStyles+'\n'+foundationCss+'\n'+componentCss).replaceAll('</style','<\\/style');
const exportCss=foundationCss+'\n'+fs.readFileSync(path.join(reportOut,'export-client.css'),'utf8')+'\n'+fs.readFileSync(path.join(reportOut,'report-server.css'),'utf8');
fs.writeFileSync(path.join(reportOut,'report.css'),exportCss);
for(const filename of ['export-client.css','report-server.css'])fs.unlinkSync(path.join(reportOut,filename));
fs.writeFileSync(path.join(appOut, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shelob</title><style>${css}</style></head><body><div id="app"><p>Connecting to Codex…</p></div><script>${script}</script></body></html>`);
for (const filename of ['app.js', 'app.css']) fs.unlinkSync(path.join(appOut, filename));
const bundledPackages = writeNotices([vendor, app, exported, rendered], path.join(plugin, 'THIRD_PARTY_NOTICES.md'), {
  baseDirectory: workspace, introduction: 'Shelob includes the following runtime libraries.'
});
console.log(JSON.stringify({ serverBytes: fs.statSync(path.join(serverOut, 'vendor.mjs')).size, appBytes: fs.statSync(path.join(appOut, 'index.html')).size, bundledPackages }));
