import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleLibrary } from '../server/rules.mjs';
import { ReviewStore } from '../server/store.mjs';
import { fixture, beforeDemo, weakenDemo } from './fixtures.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-rules-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, library: new RuleLibrary(root) };
}
const custom = { id: 'CUSTOM-001', title: 'Transaction boundaries', category: 'Data', mode: 'contextual', severity: 'error', scope: ['src/**'], rationale: 'Keep related writes atomic.', instructions: 'Trace related writes and report partial persistence only when a concrete failure can leave inconsistent state.' };
const edit = model => ({ revision: model.revision, originalId: model.pack.rules[0].id, rule: { ...model.pack.rules[0], severity: 'error', options: { maxLines: 1, maxFiles: 20 } } });

test('rule edits persist outside the plugin with immutable revisions and leave the shipped baseline intact', t => {
  const { library, root } = setup(t);
  const baseline = fs.readFileSync(new URL('../rules/baseline.json', import.meta.url));
  const model = library.get(); assert.equal(model.customized, false); assert.equal(model.pack.rules.length, 9);
  const saved = library.save(edit(model));
  assert.equal(saved.customized, true); assert.equal(saved.pack.id, 'shelob-personal');
  assert.equal(saved.pack.rules[0].severity, 'error');
  assert.notEqual(saved.revision, model.revision);
  assert.deepEqual(new RuleLibrary(root).get(), saved);
  assert.deepEqual(fs.readFileSync(new URL('../rules/baseline.json', import.meta.url)), baseline);
  const version = path.join(root, 'rules/versions', `${saved.revision}.json`), bytes = fs.readFileSync(version);
  library.save({ revision: saved.revision, rule: custom });
  assert.deepEqual(fs.readFileSync(version), bytes);
  assert.equal(fs.statSync(version).mode & 0o777, 0o600);
});

test('concurrent windows, invalid scopes, duplicate IDs, unsupported checks, and method changes cannot overwrite rules', t => {
  const { library, root } = setup(t);
  const stale = new RuleLibrary(root).get(), current = library.save(edit(stale));
  assert.throws(() => new RuleLibrary(root).save({ revision: stale.revision, rule: custom }), /changed in another window/);
  assert.throws(() => library.save({ revision: current.revision, rule: { ...custom, id: 'SCOPE-001' } }), /already exists/);
  for (const scope of [['/absolute/**'], ['../outside'], []]) assert.throws(() => library.save({ revision: current.revision, rule: { ...custom, scope } }), /metadata or scope/);
  assert.throws(() => library.save({ revision: current.revision, rule: { ...custom, mode: 'deterministic', check: 'shell' } }), /New rules must use agent review/);
  assert.throws(() => library.save({ revision: current.revision, originalId: 'SCOPE-001', rule: { ...custom, id: 'SCOPE-001' } }), /method cannot change/);
  assert.deepEqual(library.get(), current);
});

test('rules remain pinned across preparation and finalization; new runs use saved rules and explicit packs win', async t => {
  const { root, library } = setup(t);
  const sample = fixture(beforeDemo); t.after(sample.cleanup); weakenDemo(sample);
  const store = new ReviewStore({ root });
  let release, prepared;
  const gate = new Promise(resolve => release = resolve), prepare = store.prepare.bind(store);
  store.prepare = run => prepared = gate.then(() => prepare(run));
  const old = await store.start({ kind: 'local', repo: sample.repo, base: 'main' }, { wait: false });
  assert.equal(old.run.state, 'preparing');
  const changed = library.save(edit(library.get()));
  library.save({ revision: changed.revision, rule: custom });
  release(); await prepared;
  const initial = store.get(old.run.id), pinned = fs.readFileSync(initial.run.options.rules);
  assert.equal(initial.report.results.find(rule => rule.ruleId === 'SCOPE-001').severity, 'warning');
  assert.equal(initial.report.results.some(result => result.ruleId === custom.id), false);
  const final = await store.finalize(old.run.id, { schemaVersion: '1.0.0', snapshotId: initial.report.snapshot.id, assessments: [] });
  assert.equal(final.report.snapshot.id, initial.report.snapshot.id);
  assert.deepEqual(fs.readFileSync(initial.run.options.rules), pinned);
  const fresh = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  assert.equal(fresh.report.results.find(rule => rule.ruleId === 'SCOPE-001').severity, 'error');
  assert.equal(fresh.report.results.find(rule => rule.ruleId === 'SCOPE-001').status, 'findings');
  assert.equal(fresh.report.results.find(result => result.ruleId === custom.id).instructions, custom.instructions);
  assert.equal(fresh.report.results.find(result => result.ruleId === custom.id).status, 'not_assessed');
  assert.notEqual(fresh.report.snapshot.rulePackDigest, initial.report.snapshot.rulePackDigest);
  const reviewed = await store.finalize(fresh.run.id, { schemaVersion: '1.0.0', snapshotId: fresh.report.snapshot.id, assessments: [{ ruleId: custom.id, status: 'assessed', reason: 'Fixture has no persistence operations to make partially atomic.' }] });
  assert.equal(reviewed.report.results.find(result => result.ruleId === custom.id).status, 'assessed');
  const external = path.join(root, 'external.json'); fs.copyFileSync(new URL('../rules/baseline.json', import.meta.url), external);
  const explicit = await store.start({ kind: 'local', repo: sample.repo, base: 'main', rules: external });
  fs.writeFileSync(external, '{}');
  assert.equal(explicit.report.rulePack.id, 'shelob-baseline');
  const completed = await store.finalize(explicit.run.id, { schemaVersion: '1.0.0', snapshotId: explicit.report.snapshot.id, assessments: [] });
  assert.equal(completed.report.snapshot.id, explicit.report.snapshot.id);
});

test('a lock left by an interrupted server recovers; an active writer remains protected', t => {
  const { library, root } = setup(t), current = library.get();
  fs.mkdirSync(path.join(root, 'rules'));
  const lock = path.join(root, 'rules/.saving');
  fs.writeFileSync(lock, String(process.pid));
  assert.throws(() => library.save({ revision: current.revision, rule: custom }), /being saved/);
  fs.writeFileSync(lock, '2147483647');
  const saved = library.save({ revision: current.revision, rule: custom });
  assert.equal(saved.pack.rules.length, 10); assert.equal(fs.existsSync(lock), false);
});
