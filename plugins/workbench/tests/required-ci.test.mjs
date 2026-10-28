import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequired, observedChecks, collectRequiredCi } from '../server/required-ci.mjs';

const requirement = [{ context: 'tests', appId: 42 }];
const check = values => ({ kind: 'check', name: 'tests', appId: 42, id: 1, conclusion: 'success', ...values });
test('required CI distinguishes missing, failed, passed and unknown policy', () => {
  assert.equal(evaluateRequired(requirement, []).status, 'pending');
  assert.equal(evaluateRequired(requirement, [check({ conclusion: 'failure' })]).status, 'failed');
  for (const conclusion of ['success', 'neutral', 'skipped']) assert.equal(evaluateRequired(requirement, [check({ conclusion })]).status, 'satisfied');
  assert.equal(evaluateRequired([], []).status, 'none');
  assert.equal(evaluateRequired([], [], { complete: false }).status, 'unknown');
  assert.equal(evaluateRequired([], [], { unsupported: true }).status, 'unknown');
  assert.equal(observedChecks([]), 'unverified');
});
test('producer identity, reruns and statuses cannot borrow another result', () => {
  assert.equal(evaluateRequired(requirement, [check({ appId: 99 })]).status, 'pending');
  assert.equal(evaluateRequired(requirement, [check({ conclusion: 'failure' }), check({ id: 2 })]).status, 'satisfied');
  assert.equal(evaluateRequired([{ context: 'tests', appId: null }], [check({}), check({ appId: 99 })]).status, 'unknown');
  assert.equal(evaluateRequired(requirement, [check({ kind: 'status', appId: undefined })]).status, 'unknown');
  assert.equal(evaluateRequired(requirement, [check({}), check({ kind: 'status', appId: undefined, state: 'failure', conclusion: null })]).status, 'unknown');
  assert.equal(evaluateRequired([{ context: 'tests', appId: null }], [check({}), check({ kind: 'status', appId: undefined, state: 'pending', conclusion: null })]).status, 'pending');
});
test('the collector combines classic and active rules with paginated exact-commit checks', async () => {
  const calls = [], pr = { url: 'https://github.com/example/repository/pull/1', headRefOid: 'a'.repeat(40), baseRefName: 'main' };
  const read = async (endpoint, options) => {
    calls.push([endpoint, options]);
    if (endpoint.includes('/rules/')) return [[{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'tests', integration_id: 42 }] } }], []];
    if (endpoint.endsWith('/required_status_checks')) return { checks: [{ context: 'lint', app_id: 42 }] };
    if (endpoint.includes('/branches/')) return { protected: true };
    if (endpoint.includes('/check-runs')) return [{ check_runs: [{ ...check({}), app: { id: 42 } }] }, { check_runs: [{ ...check({ name: 'lint', id: 2 }), app: { id: 42 } }] }];
    if (endpoint.includes('/statuses')) return [[]];
    throw new Error('unexpected request');
  };
  assert.equal((await collectRequiredCi(pr, read)).required.status, 'satisfied');
  assert.equal(calls.filter(([endpoint]) => endpoint.includes('/commits/')).every(([endpoint]) => endpoint.includes(pr.headRefOid)), true);
  assert.equal(calls.filter(([endpoint]) => endpoint.includes('per_page')).every(([, options]) => options.pages), true);
  const denied = await collectRequiredCi(pr, async () => { throw new Error('403'); });
  assert.equal(denied.required.status, 'unknown');
});
test('partial check pages and unknown producers remain unknown', async () => {
  const pr = { url: 'https://github.com/example/repository/pull/1', headRefOid: 'a'.repeat(40), baseRefName: 'main' };
  const result = await collectRequiredCi(pr, async endpoint => {
    if (endpoint.includes('/rules/')) return [[]];
    if (endpoint.endsWith('/required_status_checks')) return { checks: [] };
    if (endpoint.includes('/branches/')) return { protected: false };
    return [{ incomplete: true }];
  });
  assert.equal(result.required.status, 'unknown');
});

test('Actions workflow event provenance separates observed success from required satisfaction', async () => {
  const pr = { url: 'https://github.com/example/repository/pull/1', headRefOid: 'a'.repeat(40), baseRefName: 'main' };
  let event = 'workflow_dispatch', denied = false, incomplete = false;
  const read = async endpoint => {
    if (endpoint.includes('/rules/')) return [[{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'tests', integration_id: 42 }] } }]];
    if (endpoint.endsWith('/required_status_checks')) return { checks: [] };
    if (endpoint.includes('/branches/')) return { protected: true };
    if (endpoint.includes('/check-runs')) return [{ check_runs: [{ ...check({}), app: { id: 42, slug: 'github-actions' }, check_suite: { id: 8 } }] }];
    if (endpoint.includes('/statuses')) return [[]];
    if (endpoint.includes('/actions/runs?check_suite_id=8')) {
      if (denied) throw new Error('403');
      return [{ total_count: incomplete ? 2 : 1, workflow_runs: [{ id: 9, check_suite_id: 8, repository: { full_name: 'example/repository' }, event }] }];
    }
    throw new Error('Unexpected request');
  };
  const dispatch = await collectRequiredCi(pr, read);
  assert.equal(dispatch.observed, 'passed'); assert.equal(dispatch.required.status, 'pending');
  for (event of ['push', 'pull_request', 'pull_request_review', 'pull_request_target', 'deployment', 'deployment_status']) assert.equal((await collectRequiredCi(pr, read)).required.status, 'satisfied');
  denied = true; assert.equal((await collectRequiredCi(pr, read)).required.status, 'unknown');
  denied = false; incomplete = true; assert.equal((await collectRequiredCi(pr, read)).required.status, 'unknown');
});

test('strict required checks use exact base ancestry and classic protection can use read-only GraphQL', async () => {
  const pr = { url: 'https://github.com/example/repository/pull/1', headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main' };
  let behind = 1, denied = false;
  const read = async (endpoint, options) => {
    if (endpoint.includes('/rules/')) return [[]];
    if (endpoint.endsWith('/required_status_checks')) throw new Error('403');
    if (endpoint.includes('/branches/')) return { protected: true };
    if (endpoint === 'graphql') {
      assert.match(options.query, /^query /);
      return { data: { repository: { ref: { branchProtectionRule: { requiresStatusChecks: true, requiresStrictStatusChecks: true, requiredStatusChecks: [{ context: 'tests', app: { databaseId: 42 } }] } } } } };
    }
    if (endpoint.includes('/compare/')) { if (denied) throw new Error('403'); return { behind_by: behind }; }
    if (endpoint.includes('/check-runs')) return [{ check_runs: [{ ...check({}), app: { id: 42, slug: 'external-ci' } }] }];
    if (endpoint.includes('/statuses')) return [[]];
    throw new Error('Unexpected request');
  };
  assert.equal((await collectRequiredCi(pr, read)).required.status, 'pending');
  behind = 0; assert.equal((await collectRequiredCi(pr, read)).required.status, 'satisfied');
  denied = true; assert.equal((await collectRequiredCi(pr, read)).required.status, 'unknown');
});
