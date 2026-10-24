import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadPack } from '../plugins/shelob/scripts/lib/rules.mjs';

export const pluginDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../plugins/shelob');
export function validatePlugin(root = pluginDirectory) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const portable = read('plugin.json'), compatibility = read('.codex-plugin/plugin.json');
  const openai = portable.extensions['com.openai'];
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(portable.name, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  assert.match(portable.version, /^\d+\.\d+\.\d+$/);
  assert.equal(portable.name, path.basename(root));
  assert.equal(portable.name, compatibility.name); assert.equal(portable.version, compatibility.version);
  assert.deepEqual(openai.interface, compatibility.interface);
  assert.equal(compatibility.skills, './skills/');
  assert.equal(compatibility.mcpServers, './mcp.json');
  const mcp = read('mcp.json');
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(mcp.mcpServers.shelob, { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server/dist/index.mjs'], cwd: '${PLUGIN_ROOT}' });
  for (const file of ['server/dist/index.mjs', 'server/dist/vendor.mjs', 'app/dist/index.html', 'THIRD_PARTY_NOTICES.md']) assert.ok(fs.statSync(path.join(root, file)).isFile(), `Build missing: ${file}`);
  assert.ok(openai.interface.shortDescription.length <= 30);
  assert.equal(openai.requires_local_executor, true);
  for (const key of ['logo', 'composerIcon']) assert.ok(fs.statSync(path.join(root, openai.interface[key])).isFile());
  const skills = fs.readdirSync(path.join(root, 'skills'));
  assert.deepEqual(skills, ['shelob-review']);
  const filename = path.join(root, 'skills/shelob-review/SKILL.md');
  const skill = fs.readFileSync(filename, 'utf8');
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(frontmatter);
  // Ruby's standard-library safe YAML parser is a packaging-time check only.
  const metadata = JSON.parse(execFileSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.safe_load(STDIN.read))'], { input: frontmatter[1], encoding: 'utf8' }));
  assert.equal(metadata.name, 'shelob-review'); assert.equal(typeof metadata.description, 'string'); assert.ok(metadata.description.length >= 100);
  for (const match of skill.matchAll(/\]\((\.\.[^)]+)\)/g)) assert.ok(fs.existsSync(path.resolve(path.dirname(filename), match[1])), `Missing reference ${match[1]}`);
  const pack = loadPack(path.join(root, 'rules/baseline.json'));
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, `Symlinks are not packaged: ${absolute}`);
      if (entry.isDirectory()) visit(absolute); else files.push(absolute);
    }
  }
  visit(root);
  const secrets = /(?:sk-[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-z0-9]{36}|xox[bpars]-[a-z0-9-]+|AIza[a-z0-9_-]{35}|dxu_[a-z0-9_]+|[?&](?:key|token|api_key|access_token|apikey)=[a-z0-9]|https?:\/\/[^/\s:@]+:[^/\s@]+@|\b(?:api[_-]?key|apikey|token|secret|password|passwd|bearer|auth)\s*[:=]\s*["']?[a-z0-9_.-]{16,})/i;
  // The exact packaged PNG is scanned as its own file. Its base64 representation
  // can coincidentally resemble a key; omit only these known image bytes from
  // text scans, retaining checks on all surrounding markup and other payloads.
  const inlineLogo = `data:image/png;base64,${fs.readFileSync(path.join(root, 'assets/logo.png')).toString('base64')}`;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').replaceAll(inlineLogo, '[bundled Shelob logo]');
    assert.equal(secrets.test(source), false, `Potential credential in ${path.relative(root, file)}; inspect without echoing the value.`);
    if (file.endsWith('.json')) JSON.parse(source);
    if (file.endsWith('.mjs')) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  return { plugin: portable.name, version: portable.version, skills: skills.length, rules: pack.rules.length, files: files.length, secrets: 'none detected', yaml: 'parsed with Ruby safe_load', descriptionCharacters: metadata.description.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(validatePlugin(), null, 2));
