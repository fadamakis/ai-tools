import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { preservationBaselinePath, verifyPreservationBaseline } from '../../../scripts/workbench-preservation.mjs';

const hash = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-preservation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), cache = path.join(root, 'cache');
  for (const directory of [source, cache]) { fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'plugin.json'), '{"name":"fixture"}\n'); }
  const note = path.join(root, 'original.md'), marketplace = path.join(root, 'marketplace.json'), filename = path.join(root, 'baseline.json');
  fs.writeFileSync(note, 'Original decision.\n'); fs.writeFileSync(marketplace, '{"name":"personal"}\n');
  const baseline = { source, cache, files: { 'plugin.json': hash(path.join(source, 'plugin.json')) }, legacyNotes: { [note]: hash(note) }, personalMarketplaceSha256: hash(marketplace) };
  const save = () => fs.writeFileSync(filename, JSON.stringify(baseline) + '\n'); save();
  return { source, cache, note, marketplace, filename, baseline, save, verify: () => verifyPreservationBaseline(filename, { personalMarketplacePath: marketplace }) };
}

test('packaging keeps its historical baseline unless one explicit file is selected', () => {
  assert.equal(preservationBaselinePath([], '/historical.json'), '/historical.json');
  assert.equal(preservationBaselinePath(['--preservation-baseline', '/approved-current.json'], '/historical.json'), '/approved-current.json');
  for (const args of [['--skip-preservation'], ['--preservation-baseline'], ['--preservation-baseline', ''], ['--preservation-baseline', '--unknown'], ['--preservation-baseline', '/one', '/two']]) {
    assert.throws(() => preservationBaselinePath(args, '/historical.json'), /Usage:/);
  }
});

test('an explicit preservation snapshot verifies source/cache/notes/marketplace and returns its pinned identity', t => {
  const sample = fixture(t), before = fs.readFileSync(sample.filename);
  const { receipt } = sample.verify();
  assert.equal(receipt.path, sample.filename); assert.equal(receipt.sha256, hash(sample.filename));
  assert.equal(receipt.protectedFiles, 1); assert.equal(receipt.originalNotes, 1);
  assert.deepEqual(fs.readFileSync(sample.filename), before);
});

for (const target of ['source', 'cache', 'note', 'marketplace']) {
  test(`preservation rejects ${target} drift without recapturing or changing the snapshot`, t => {
    const sample = fixture(t), before = fs.readFileSync(sample.filename);
    const filename = ['source', 'cache'].includes(target) ? path.join(sample[target], 'plugin.json') : sample[target];
    fs.appendFileSync(filename, 'Unexpected drift.\n');
    assert.throws(sample.verify, /changed/i);
    assert.deepEqual(fs.readFileSync(sample.filename), before);
  });
}

test('preservation rejects empty and escaping file inventories', t => {
  const sample = fixture(t);
  sample.baseline.files = {}; sample.save(); assert.throws(sample.verify, /pin protected files/);
  sample.baseline.files = { '../outside': 'a'.repeat(64) }; sample.save(); assert.throws(sample.verify, /Invalid preservation path/);
});
