import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = ['autopilot', 'greenlight', 'help', 'implement', 'improve', 'plan', 'prepare', 'publish', 'review', 'run', 'start', 'translations', 'verify'];

test('only the 13 canonical Preview skills are discoverable and every one requires explicit invocation', () => {
  const discoverable = [];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(filename);
      else if (entry.name === 'SKILL.md') discoverable.push(path.relative(root, filename));
    }
  }
  scan(root);
  assert.deepEqual(discoverable.sort(), canonical.map(name => `skills/${name}/SKILL.md`).sort());
  const policies = Object.fromEntries(canonical.map(name => [name, fs.readFileSync(path.join(root, 'skills', name, 'agents/openai.yaml'), 'utf8')]));
  const parsed = JSON.parse(execFileSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(JSON.parse(STDIN.read).transform_values { |source| YAML.safe_load(source) })'], { input: JSON.stringify(policies), encoding: 'utf8' }));
  for (const name of canonical) assert.equal(parsed[name]?.policy?.allow_implicit_invocation, false, `${name} must require explicit invocation`);
});
