import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fixture, beforeDemo, weakenDemo } from './fixtures.mjs';
import { createReport } from '../scripts/shelob.mjs';
import { renderReportView } from '../assets/dist/report-server.mjs';
import { auditOutcome, summarizeChecks, reviewVerdict } from '../assets/report-model.mjs';
import { renderReport } from '../scripts/lib/report.mjs';
function reportFixture(t) { const item=fixture(beforeDemo); t.after(item.cleanup); weakenDemo(item); const report=createReport({repo:item.repo,scope:'all',base:'main'}); delete report.analysis.execution; return report; }
function document(t,html) { const dom=new JSDOM(html);t.after(()=>dom.window.close());return dom.window.document; }
test('review outcomes never count missing, failed, or partially assessed checks as passed', () => {
  const result = (status, findings = []) => ({ status, findings });
  assert.equal(auditOutcome(result('assessed')), 'passed');
  assert.equal(auditOutcome(result('findings', [{}])), 'attention');
  assert.equal(auditOutcome(result('not_assessed', [{}])), 'attention');
  assert.equal(auditOutcome(result('error', [{}])), 'attention');
  for (const status of ['not_assessed', 'error', 'findings', 'unknown']) assert.equal(auditOutcome(result(status)), 'not_checked');
  assert.equal(auditOutcome(result('not_applicable')), 'not_applicable');
  assert.deepEqual(summarizeChecks([result('assessed'), result('not_assessed')]), {
    attention: 0, passed: 1, not_checked: 1, not_applicable: 0, total: 2, state: 'not_checked',
  });
  assert.equal(summarizeChecks([result('assessed'), result('findings', [{}, {}])]).attention, 1, 'counts checks rather than findings');
  assert.equal(summarizeChecks([result('assessed'), result('not_assessed', [{}])]).state, 'attention');
  assert.equal(summarizeChecks([result('not_applicable')]).state, 'not_applicable');
  assert.equal(summarizeChecks([]).state, 'not_applicable');
});

test('verdict separates approval, notes, and required changes using findings and completed coverage', () => {
  const result = (status, severity) => ({ status, findings: severity ? [{ severity }] : [] });
  assert.deepEqual(reviewVerdict([result('assessed'), result('not_applicable')]), {
    state: 'approve', label: 'Approve', reason: 'The check passed.',
    coverage: { completed: 1, applicable: 1, percent: 100 },
  });
  for (const severity of ['warning', 'info']) {
    const verdict = reviewVerdict([result('findings', severity)]);
    assert.equal(verdict.state, 'notes');
    assert.equal(verdict.label, 'Approve with notes');
    assert.equal(verdict.reason, '1 nonblocking note. No changes required for approval.');
    assert.equal(verdict.coverage.percent, 100, 'coverage is completion, independent of quality');
  }
  const changes = reviewVerdict([result('findings', 'error'), result('not_assessed')]);
  assert.equal(changes.state, 'changes');
  assert.equal(changes.label, 'Request changes');
  assert.equal(changes.reason, '1 high-severity finding blocks approval. 1 check still needs review.');
  assert.equal(changes.coverage.percent, 50);
  for (const status of ['not_assessed', 'error', 'unknown']) {
    const verdict = reviewVerdict([result('assessed'), result(status)]);
    assert.equal(verdict.state, 'incomplete', 'missing context or a failed scan cannot produce green approval');
    assert.equal(verdict.reason, '1 check still needs review.');
  }
  const partial = reviewVerdict([result('not_assessed', 'warning')]);
  assert.equal(partial.coverage.completed, 0, 'a partial finding is not a completed check');
  assert.match(partial.reason, /1 check still needs review/);
  for (const results of [[], [result('not_applicable')]]) {
    const verdict = reviewVerdict(results);
    assert.equal(verdict.state, 'incomplete');
    assert.deepEqual(verdict.coverage, { completed: 0, applicable: 0, percent: 0 });
  }
});

test('server-rendered reports retain every check and finding as readable progressive content',t=>{
 const report=reportFixture(t),original=JSON.stringify(report),doc=document(t,renderReport(report));
 assert.deepEqual(summarizeChecks(report.results),{attention:3,passed:2,not_checked:4,not_applicable:0,total:9,state:'attention'});
 assert.equal(doc.querySelectorAll('.audit').length,report.results.length);
 assert.equal(doc.querySelectorAll('.finding').length,report.results.flatMap(r=>r.findings).length);
 assert.equal(doc.querySelectorAll('.audit[hidden]').length,0,'all checks remain readable with JavaScript disabled');
 assert.equal(doc.querySelector('[data-enhanced]').dataset.enhanced,'false');
 assert.equal(doc.querySelector('.review-summary').dataset.verdict,'incomplete');
 assert.match(doc.querySelector('.support-section').textContent,/4 of 9|5 of 9/);
 assert.equal(JSON.stringify(report),original,'rendering never rewrites source evidence');
});
test('the report distinguishes green notes, blocked approval, failures, and inapplicable checks',t=>{
 const report=reportFixture(t);report.results=report.results.map(r=>({...r,status:'assessed',findings:[]}));
 let doc=document(t,renderReport(report));assert.equal(doc.querySelector('[data-verdict]').dataset.verdict,'approve');assert.match(doc.querySelector('.review-summary h2').textContent,/Review complete/);
 const entry=report.results.find(r=>r.mode==='contextual');entry.findings=[{id:'optional',severity:'warning',title:'Optional note',message:'A useful detail.',nextAction:'Check the choice.',evidence:[]}];entry.status='findings';
 doc=document(t,renderReport(report));assert.equal(doc.querySelector('[data-verdict]').dataset.verdict,'notes');assert.match(doc.querySelector('.severity').textContent,/Medium/);
 entry.findings[0].severity='error';doc=document(t,renderReport(report));assert.equal(doc.querySelector('[data-verdict]').dataset.verdict,'changes');assert.match(doc.querySelector('.review-summary h2').textContent,/Changes required/);
 entry.findings=[];report.results[0].findings=[];report.results[0].status='error';report.results[0].reason='Source could not be read.';report.results[1].status='not_applicable';doc=document(t,renderReport(report));assert.equal(doc.querySelector('[data-verdict]').dataset.verdict,'incomplete');assert.match(doc.querySelector('.support-section').textContent,/Source could not be read/);assert.ok(doc.querySelector('[data-outcome=not_applicable]'));
});
test('source gaps and stale PRs never render ready for approval',t=>{
 const report=reportFixture(t);report.results=report.results.map(r=>({...r,status:'assessed',findings:[]}));report.status='incomplete';report.notices=[{title:'Source skipped',message:'These files were not reviewed.'}];
 let doc=document(t,renderReport(report));assert.equal(doc.querySelector('[data-verdict]').dataset.verdict,'incomplete');assert.match(doc.querySelector('.support-section').textContent,/These files were not reviewed/);
 report.status='no_findings';report.source={kind:'github_pr',repository:'example/repo',number:1,url:'https://github.com/example/repo/pull/1'};
 for(const status of ['unknown','outdated']){report.freshness={status,message:'Check PR freshness.'};doc=document(t,renderReport(report));assert.equal(doc.querySelector('[data-verdict]').dataset.verdict,'incomplete');}
});
test('offline report totals and status labels retain failures and partial coverage',t=>{
 const report=reportFixture(t);report.results=report.results.map(r=>({...r,status:'assessed',findings:[]}));
 report.results[0].findings=[{id:'blocker',severity:'error',title:'A confirmed defect',message:'Requires a fix.',evidence:[]}];report.results[0].status='not_assessed';
 report.results[1].status='error';report.results[1].reason='Execution stopped.';
 const original=JSON.stringify(report),doc=document(t,renderReport(report));
 assert.equal(doc.querySelector('.check-results .not_applicable'),null,'zero secondary totals are omitted');
 assert.equal(doc.querySelector('.check-results .notes'),null,'empty notes do not occupy a tile');
 assert.ok(doc.querySelector('.check-results .passed'));
 assert.match(doc.querySelector('.check-results .failed').textContent,/1Failed/);
 assert.match(doc.querySelector('.check-results .not_checked').textContent,/1Not checked/);
 assert.equal(doc.querySelectorAll('.check-result-badge.failed').length,1);
 assert.match(doc.querySelector('.check-detail-status').textContent,/Failed.*Coverage incomplete/);
 assert.match(doc.querySelectorAll('.check-detail-status')[1].textContent,/Could not run/);
 assert.equal(doc.querySelector('[data-verdict]').dataset.verdict,'changes');
 assert.equal(JSON.stringify(report),original);
});
test('export data roundtrips untrusted content and includes no external executable assets',t=>{
 const report=reportFixture(t);report.results[0].title='</script><img src=x onerror=alert(1)>';report.repository.name='Untrusted <report>';const html=renderReport(report),doc=document(t,html);
 assert.deepEqual(JSON.parse(doc.getElementById('report-data').textContent),report);
 assert.equal(doc.querySelectorAll('img[onerror],script[src],link[href^="http"],img[src^="http"]').length,0);
 assert.equal(doc.querySelectorAll('script').length,2);const scripts=[...doc.querySelectorAll('script')];assert.ok(scripts.every(s=>s.nonce&&s.nonce===scripts[0].nonce));
 assert.ok(doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("default-src 'none'"));
 assert.ok(doc.querySelector('a[download]'));assert.match(doc.querySelector('.support-section').textContent,/Shelob did not run tests/);
 const css=doc.querySelector('style').textContent;assert.ok(css.includes('prefers-reduced-motion'));assert.ok(css.includes('@media print'));
});
test('embedded reports retain discussion markers, exact receipts and advisory classification',t=>{
 const report=reportFixture(t),findings=report.results.flatMap(r=>r.findings),first=findings[0];report.source={kind:'github_pr',repository:'example/repo',number:1,url:'https://github.com/example/repo/pull/1'};report.freshness={status:'current'};
 const publishing={discussed:[first.id],comments:{[findings[1].id]:{state:'posted',draft:'Exact sent text.',url:report.source.url+'#comment-1'}}};
 const doc=document(t,renderReportView(report,{embedded:true,canPostComments:true,publishing}));
 assert.equal(doc.querySelectorAll('.comment-actions button[data-discussed=true]').length,1);assert.ok([...doc.querySelectorAll('textarea')].some(el=>el.value==='Exact sent text.'&&el.readOnly));
 assert.ok(doc.querySelector('[data-advisory=true]'));assert.ok(doc.querySelector('a[href$="#comment-1"]'));assert.equal(doc.getElementById('approve-pr'),null);
});
test('legacy 1.0 reports render without newer optional source or execution fields',t=>{
 const report=reportFixture(t);report.schemaVersion='1.0.0';delete report.source;delete report.analysis.execution;delete report.analysis.codeReview;
 const original=JSON.stringify(report),doc=document(t,renderReport(report));assert.equal(doc.querySelectorAll('.audit').length,report.results.length);assert.ok(doc.querySelector('.support-section'));assert.equal(JSON.stringify(report),original);
});
