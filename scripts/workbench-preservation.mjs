import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

export function preservationBaselinePath(args, historicalBaseline) {
  if (!args.length) return historicalBaseline;
  if (args.length !== 2 || args[0] !== '--preservation-baseline' || !args[1].trim() || args[1].startsWith('--')) {
    throw new Error('Usage: workbench-package.mjs [--preservation-baseline <file>]');
  }
  return path.resolve(args[1]);
}

export function verifyPreservationBaseline(filename, { personalMarketplacePath = path.join(os.homedir(), '.agents/plugins/marketplace.json') } = {}) {
  const baseline = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const mapping = value => value && typeof value === 'object' && !Array.isArray(value);
  assert.ok(typeof baseline.source === 'string' && path.isAbsolute(baseline.source), 'Preservation baseline needs an absolute source path.');
  assert.ok(typeof baseline.cache === 'string' && path.isAbsolute(baseline.cache), 'Preservation baseline needs an absolute cache path.');
  assert.ok(mapping(baseline.files) && Object.keys(baseline.files).length, 'Preservation baseline must pin protected files.');
  assert.ok(mapping(baseline.legacyNotes), 'Preservation baseline must pin the original note inventory.');
  for (const [relative, checksum] of Object.entries(baseline.files)) {
    assert.ok(relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), `Invalid preservation path: ${relative}`);
    assert.match(checksum, /^[a-f0-9]{64}$/, `Invalid preservation checksum: ${relative}`);
    assert.equal(hash(path.join(baseline.source, relative)), checksum, `Current Workbench source changed: ${relative}`);
    assert.equal(hash(path.join(baseline.cache, relative)), checksum, `Current installed Workbench changed: ${relative}`);
  }
  for (const [note, checksum] of Object.entries(baseline.legacyNotes)) {
    assert.ok(path.isAbsolute(note), 'Preserved original note paths must be absolute.');
    assert.match(checksum, /^[a-f0-9]{64}$/, 'Invalid original note checksum.');
    assert.equal(hash(note), checksum, `Original task note changed: ${note}`);
  }
  assert.match(baseline.personalMarketplaceSha256, /^[a-f0-9]{64}$/, 'Preservation baseline must pin the personal marketplace.');
  assert.equal(hash(personalMarketplacePath), baseline.personalMarketplaceSha256, 'Personal marketplace changed.');
  return { baseline, receipt: { path: path.resolve(filename), sha256: hash(filename), source: baseline.source, cache: baseline.cache, protectedFiles: Object.keys(baseline.files).length, originalNotes: Object.keys(baseline.legacyNotes).length } };
}
