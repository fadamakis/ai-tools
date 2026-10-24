import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPublicText} from '../../scripts/check-public.mjs';

test('public content rejects real tenant URLs, personal paths and workspace bindings without echoing their values',()=>{
  const tenant=['private-team','slack','com'].join('.');
  const home=['','Users','private-person','projects','app'].join('/');
  const binding='Plugin_'+'a'.repeat(32);
  const findings=inspectPublicText(`https://${tenant}/archives/example\n${home}\n${binding}`,'fixture.md');
  assert.deepEqual(findings.map(item=>item.category),['workspace-specific URL','personal home path','workspace listing binding']);
  const report=JSON.stringify(findings);
  assert.ok(!report.includes(tenant)&&!report.includes(home)&&!report.includes(binding));
});

test('synthetic examples and public provider documentation remain usable',()=>{
  assert.deepEqual(inspectPublicText('https://example.slack.com/archives/C123 https://example.atlassian.net/browse/TEST-1 https://api.slack.com/ /Users/you/projects/app /Users/designer/example','README.md'),[]);
});
