import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'yaml';
import {products,files} from './release.mjs';
export function validate(root=process.cwd(), packaged=false) {
 for(const name of products) {
  const plugin=path.join(root,'plugins',name), manifest=JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'),'utf8'));
  const overlay=JSON.parse(fs.readFileSync(path.join(plugin,'.codex-plugin/plugin.json'),'utf8'));
  assert.equal(manifest.name,name);assert.equal(manifest.$schema,'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);assert.equal(overlay.version,manifest.version);assert.equal(overlay.name,name);
  const openai=manifest.extensions['com.openai'];assert.deepEqual(overlay.interface,openai.interface);assert.ok(openai.interface.shortDescription.length<=30);
  for(const key of ['logo','composerIcon']) assert.ok(fs.statSync(path.resolve(plugin,openai.interface[key])).isFile());
  const mcp=JSON.parse(fs.readFileSync(path.join(plugin,'mcp.json'),'utf8'));
  assert.equal(mcp.$schema,'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  for(const server of Object.values(mcp.mcpServers)) {
   assert.equal(server.command,'node');assert.equal(server.cwd,'${PLUGIN_ROOT}');
   assert.ok(server.args.every(arg=>arg.startsWith('${PLUGIN_ROOT}/')));
   for(const arg of server.args) assert.ok(fs.statSync(arg.replace('${PLUGIN_ROOT}',plugin)).isFile());
  }
  const skills=fs.readdirSync(path.join(plugin,'skills')).sort();
  if(name==='workbench') assert.equal(skills.length,13);
  for(const skillName of skills) {
   const file=path.join(plugin,'skills',skillName,'SKILL.md'), text=fs.readFileSync(file,'utf8');
   const front=text.match(/^---\n([\s\S]*?)\n---\n/);assert.ok(front,file);
   const meta=parse(front[1]);assert.equal(meta.name,skillName);assert.ok(meta.description.trim());
   for(const match of text.matchAll(/\]\((\.\.[^)]+)\)/g)) assert.ok(fs.existsSync(path.resolve(path.dirname(file),match[1].split('#')[0])),`${name}: missing skill reference ${match[1]}`);
  }
  if(packaged) for(const file of files(plugin)) {
   const relative=path.relative(plugin,file);
   assert.ok(!/(^|\/)(node_modules|tests|\.data|test-results)(\/|$)|\.sqlite(?:-|$)/.test(relative),relative);
   if(/\.(mjs|js|json|md|yaml|html|css)$/.test(file)) {
    const text=fs.readFileSync(file,'utf8');
    assert.ok(!/\/(?:Users|home)\/(?!you\/|example\/|designer\/)[^/\s]+\//.test(text),`Personal filesystem path in ${relative}`);
    assert.ok(!/\b(?:ghp_[A-Za-z0-9]{36}|xox[bpars]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{24,})\b/.test(text),`Possible credential in ${relative}`);
   }
  }
 }
 return {products:products.length,status:'valid'};
}
if(process.argv[1]?.endsWith('/validate.mjs')||process.argv[1]==='scripts/validate.mjs') console.log(validate(process.argv[2]||process.cwd(),process.argv.includes('--packaged')));
