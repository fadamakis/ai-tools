import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { writeNotices } from './notices.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(workspace, 'plugins/workbench');
const out = path.join(plugin, 'app/dist'), serverOut = path.join(plugin, 'server/dist');
for (const directory of [out, serverOut]) fs.mkdirSync(directory, { recursive: true });
const locking = await build({ stdin: { contents: "export { default } from 'proper-lockfile';", resolveDir: workspace }, bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: path.join(serverOut, 'locking.mjs'), metafile: true, banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, legalComments: 'inline' });
const version = JSON.parse(fs.readFileSync(path.join(plugin, 'plugin.json'), 'utf8')).version;
const vendor = await build({ stdin: { contents: "export { McpServer } from '@modelcontextprotocol/server'; export { serveStdio } from '@modelcontextprotocol/server/stdio'; export { OpenAIExtensions } from '@openai/mcp-extensions/server'; export { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'; export { z } from 'zod';", resolveDir: workspace }, bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: path.join(serverOut, 'vendor.mjs'), metafile: true, banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, legalComments: 'inline' });
fs.writeFileSync(path.join(serverOut, 'index.mjs'), "import { serveStdio } from './vendor.mjs';\nimport { createServer } from '../index.mjs';\nserveStdio(() => createServer());\n");
const app = await build({ entryPoints: [path.join(plugin, 'app/main.jsx')], bundle: true, platform: 'browser', target: 'es2022', format: 'iife', outfile: path.join(out, 'app.js'), minify: true, metafile: true, loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"', __WORKBENCH_VERSION__: JSON.stringify(version) }, legalComments: 'inline' });
const foundation = await postcss([tailwind({ optimize: true })]).process(fs.readFileSync(path.join(plugin, 'app/app.css'), 'utf8'), { from: path.join(plugin, 'app/app.css') });
foundation.root.walkAtRules('font-face', rule => { if (/font-family:\s*KaTeX/.test(rule.toString())) rule.remove(); });
const css = [fs.readFileSync(fileURLToPath(import.meta.resolve('@openai/mcp-extensions/app/styles.css')), 'utf8'), foundation.root.toString(), fs.readFileSync(path.join(out, 'app.css'), 'utf8')].join('\n').replaceAll('</style', '<\\/style');
const js = fs.readFileSync(path.join(out, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workbench Preview</title><style>${css}</style></head><body><div id="app"><p>Connecting to Workbench Preview…</p></div><script>${js}</script></body></html>`);
for (const filename of ['app.js', 'app.css']) fs.unlinkSync(path.join(out, filename));
const bundledPackages = writeNotices([vendor, app, locking], path.join(plugin, 'THIRD_PARTY_NOTICES.md'), {
  baseDirectory: workspace, introduction: 'Workbench Preview bundles the following runtime libraries.'
});
console.log(JSON.stringify({ plugin, version, appBytes: fs.statSync(path.join(out, 'index.html')).size, bundledPackages }));
