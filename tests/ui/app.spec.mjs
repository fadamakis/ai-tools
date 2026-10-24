import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const version=JSON.parse(fs.readFileSync('plugins/shelob/plugin.json','utf8')).version;
import { pathToFileURL } from 'node:url';
const base=pathToFileURL(path.resolve(`dist/shelob-${version}-preview/index.html`)).href;
const firstId='12345678-1234-4123-8123-123456789abc';
async function open(page,query=''){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+query);const app=page.frameLocator('iframe');await expect(app.getByRole('heading',{name:'Your reviews',exact:true})).toBeVisible();return {app,errors};
}
async function report(page,app,id=firstId){
 const row=app.locator(`[data-run="${id}"]`);if(!await row.isVisible())await app.locator('.previous-reviews summary').click();await row.click();await expect(row).toHaveAttribute('aria-current','true');await expect(app.locator('.check-workspace')).toBeVisible();
}
async function menu(app,name){await app.getByRole('button',{name:'More options',exact:true}).click();await app.getByRole('menuitem',{name,exact:true}).click();}
async function prepare(app){const area=app.locator('.check-detail:visible');if(!await area.locator('textarea').first().isVisible())await area.getByRole('button',{name:'Prepare comment',exact:true}).first().click();return area.locator('textarea').first();}
async function checks(app){await app.locator('#checks-picker').click();return app.getByRole('region',{name:'Checks',exact:true});}

test('checks expand inline, preserve the inbox position and collapse with keyboard focus restored',async({page})=>{
 const {app}=await open(page);await report(page,app,'22345678-1234-4123-8123-123456789abc');
 const row=app.locator('[data-run="22345678-1234-4123-8123-123456789abc"]'),before=await row.boundingBox();
 const panel=await checks(app);await expect(panel).toBeVisible();await expect(app.getByRole('dialog')).toHaveCount(0);
 await expect(app.locator('#checks-picker')).toHaveAttribute('aria-expanded','true');await expect(panel.locator('#search')).toBeFocused();
 expect((await row.boundingBox()).y).toBe(before.y);await page.screenshot({path:`dist/releases/${version}/checks-expanded-desktop.png`,animations:'disabled',fullPage:true});await panel.locator('#search').fill('TEST');
 await app.locator('#refresh').click();await expect(app.locator('#refresh')).toBeEnabled();await expect(panel.locator('#search')).toHaveValue('TEST');
 await panel.locator('#search').press('Escape');await expect(panel).toHaveCount(0);await expect(app.locator('#checks-picker')).toBeFocused();
 await expect(app.locator('#checks-picker')).toHaveAttribute('aria-expanded','false');
});
test('nonzero not-applicable counts remain available and review disclosures have a compact gap',async({page})=>{
 const {app}=await open(page);await page.evaluate(()=>{const result=window.__shelobPreview.fixture.values[0].report.results.find(r=>!r.findings.length);result.status='not_applicable';result.reason='This check does not apply to this change.';});await report(page,app);
 const button=app.getByRole('button',{name:'Show not applicable checks (1)',exact:true});await expect(button).toBeVisible();await button.click();
 const panel=app.getByRole('region',{name:'Checks',exact:true});await expect(panel.locator('.check-row')).toHaveCount(1);await panel.locator('.check-row').click();
 await expect(app.locator('.check-detail:visible .check-result-badge')).toHaveText('·Not applicable');
 const about=await app.locator('.check-detail:visible .rule-details>summary').boundingBox(),details=await app.locator('.support-section>summary').boundingBox();
 expect(details.y-about.y-about.height).toBeGreaterThanOrEqual(0);expect(details.y-about.y-about.height).toBeLessThanOrEqual(16);
});
test('the expanded check list fits a narrow screen and returns to readable evidence',async({page})=>{
 await page.setViewportSize({width:390,height:844});const {app,errors}=await open(page);await report(page,app,'22345678-1234-4123-8123-123456789abc');
 const panel=await checks(app);await expect(panel).toBeVisible();expect((await app.locator('.reader-content').boundingBox()).height).toBeGreaterThan(80);
 expect(await app.locator('html').evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
 await page.screenshot({path:`dist/releases/${version}/checks-expanded-mobile.png`,animations:'disabled',fullPage:true});
 await panel.getByRole('button',{name:'Filters',exact:true}).click();await panel.getByRole('button',{name:'All severities',exact:true}).click();await app.getByText('High · Blocking',{exact:true}).last().click();await expect(panel.locator('.check-row')).toHaveCount(1);
 await panel.locator('.check-row').first().click();await expect(panel).toHaveCount(0);await expect(app.locator('.check-detail:visible h2')).toBeFocused();expect(errors).toEqual([]);
});

test('result totals show failures and passes and open their checks without losing a draft',async({page})=>{
 const {app,errors}=await open(page);await report(page,app,'22345678-1234-4123-8123-123456789abc');
 const summary=app.getByRole('region',{name:'Check results',exact:true});
 await expect(summary.getByRole('button',{name:'Show failed checks (1)',exact:true})).toBeEnabled();
 await expect(summary.getByRole('button',{name:'Show passed checks (7)',exact:true})).toBeEnabled();
 await expect(summary.getByRole('button',{name:'Show checks with nonblocking notes (2)',exact:true})).toBeEnabled();
 await expect(summary.getByRole('button',{name:'Show unchecked checks (0)',exact:true})).toHaveCount(0);
 await expect(summary.getByRole('button',{name:'Show not applicable checks (0)',exact:true})).toHaveCount(0);
 await expect(app.locator('.check-detail:visible .check-result-badge').first()).toHaveText('×Failed');
 await page.screenshot({path:`dist/releases/${version}/failed-check-compact.png`,animations:'disabled',fullPage:true});
 await (await prepare(app)).fill('Keep this draft while inspecting successful checks.');
 await summary.getByRole('button',{name:'Show passed checks (7)',exact:true}).click();
 const dialog=app.getByRole('region',{name:'Checks',exact:true});await expect(dialog.locator('.check-row')).toHaveCount(7);
 await expect(dialog.locator('.check-row .check-result-badge.passed')).toHaveCount(7);
 await dialog.locator('.check-row').first().press('ArrowDown');await expect(dialog.locator('.check-row').nth(1)).toBeFocused();await page.keyboard.press('Enter');
 await expect(app.locator('.check-detail:visible .check-result-badge').first()).toHaveText('✓Passed');
 await summary.getByRole('button',{name:'Show failed checks (1)',exact:true}).click();await dialog.locator('.check-row').click();
 await expect(app.locator('.check-detail:visible textarea')).toHaveValue('Keep this draft while inspecting successful checks.');
 await expect(app.locator('.check-detail:visible h2')).toBeFocused();
 const requests=await page.evaluate(()=>window.__shelobPreview.requests);expect(requests.some(r=>['shelob.start','shelob.review_post'].includes(r.params?.name))).toBe(false);expect(errors).toEqual([]);
 await page.screenshot({path:`dist/releases/${version}/failed-check-desktop.png`,animations:'disabled',fullPage:true});
});
test('unchecked and failed-execution checks are visibly distinct from successful checks',async({page})=>{
 const {app}=await open(page);await page.evaluate(()=>{window.__shelobPreview.fixture.values[2].report.results.find(r=>r.ruleId==='CODEX-REVIEW').status='error';});
 await report(page,app,'32345678-1234-4123-8123-123456789abc');
 await app.getByRole('button',{name:'Show unchecked checks (1)',exact:true}).click();
 const dialog=app.getByRole('region',{name:'Checks',exact:true});await expect(dialog.locator('.check-row')).toHaveCount(1);await expect(dialog.locator('.check-result-badge')).toHaveText('−Could not run');
 await dialog.locator('.check-row').click();await expect(app.locator('.check-detail:visible .check-result-badge').first()).toHaveText('−Could not run');await expect(app.locator('#approve-pr')).toHaveCount(0);
});

test('a running PR without a final freshness receipt displays progress and disables duplicate launches',async({page})=>{
 const {app,errors}=await open(page);
 await page.evaluate(()=>{
  const value=window.__shelobPreview.fixture.values[0];value.run.state='awaiting_review';
  delete value.report.freshness;
  value.report.analysis.execution={state:'pending',label:'Review in progress · PR-only',reason:'Native Codex review is running.'};
  value.report.analysis.codeReview.status='running';
  const general=value.report.results.find(result=>result.ruleId==='CODEX-REVIEW');general.status='not_assessed';general.findings=[];general.reason='Native Codex review is running.';
 });
 await report(page,app);
 await expect(app.getByRole('heading',{name:'Review in progress',exact:true})).toBeVisible();
 await expect(app.getByRole('button',{name:'Review in progress',exact:true})).toBeDisabled();
 await expect(app.getByRole('button',{name:'Start fresh review',exact:true})).toHaveCount(0);
 await page.screenshot({path:`dist/releases/${version}/active-pr-progress.png`,animations:'disabled',fullPage:true});
 expect(errors).toEqual([]);
});

test('the global review rail refreshes another conversation completion without selecting or launching it',async({page})=>{
 await page.clock.install();const {app,errors}=await open(page);
 await page.evaluate(()=>{
  const row=window.__shelobPreview.fixture.reviews[0];row.state='complete';
  row.execution={state:'failed',label:'Failed · PR-only'};
  row.decision={state:'failed',label:'Needs review',comments:{required:0}};
 });
 await page.clock.fastForward(15000);
 await expect(app.locator(`[data-run="${firstId}"] .queue-outcome`)).toHaveText('Needs review');
 await expect(app.getByRole('heading',{name:'Choose a review',exact:true})).toBeVisible();
 const requests=await page.evaluate(()=>window.__shelobPreview.requests);
 expect(requests.some(request=>['shelob.start','shelob.code_review','shelob.review_post'].includes(request.params?.name))).toBe(false);
 expect(errors).toEqual([]);
});

test('history stays beside the report with one selected check and an explicit approval action',async({page})=>{
 const {app,errors}=await open(page);await expect(app.locator('#pr-form')).toHaveCount(0);await report(page,app);await expect(app.locator('.review-rail')).toBeVisible();await expect(app.locator('.check-detail:visible')).toHaveCount(1);await expect(app.locator('#approve-pr')).toBeEnabled();await expect(app.locator('.check-list')).toHaveCount(0);expect(errors).toEqual([]);await page.screenshot({path:`dist/releases/${version}/desktop.png`,fullPage:true});
});
test('opening a report keeps the rail mounted, the selected row in place and the document unscrolled',async({page})=>{
 const {app}=await open(page);const before=await app.locator('.review-rail').boundingBox();await report(page,app);const after=await app.locator('.review-rail').boundingBox();expect(after.y).toBe(before.y);expect(after.height).toBe(before.height);expect(await app.locator('html').evaluate(()=>scrollY)).toBe(0);expect((await app.locator('.check-detail:visible').boundingBox()).y).toBeLessThan(400);
});
test('source links route through the host in an opaque sandbox',async({page})=>{
 const {app,errors}=await open(page);await report(page,app);await app.getByRole('link',{name:'Open pull request ↗',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__shelobPreview.openedLinks)).toEqual(['https://github.com/example/repository/pull/128']);expect(errors).toEqual([]);
});
test('new-review source controls and Enter submission work without allow-forms',async({page})=>{
 const {app}=await open(page);await app.locator('#new-review').click();await expect(app.getByRole('radio',{name:'PR only',exact:true})).toBeChecked();await app.getByRole('radio',{name:'Local copy',exact:true}).click();await app.locator('#pr-url').fill('https://github.com/example/repo/pull/1');await app.locator('.rule-options summary').filter({hasText:'Rule pack'}).click();await app.locator('#pr-rules').fill('/explicit/rules.json');await app.locator('.rule-options summary').filter({hasText:'Review request'}).click();await app.getByLabel('Requested by',{exact:true}).fill('Review requester fixture');await app.getByLabel('Request link',{exact:true}).fill('https://example.invalid/review-request');await page.keyboard.press('Enter');await expect(app.getByRole('dialog')).toHaveCount(0);const requests=await page.evaluate(()=>window.__shelobPreview.requests);expect(requests.find(r=>r.params?.name==='shelob.start').params.arguments).toMatchObject({reviewMode:'local_copy',rules:'/explicit/rules.json',requester:{name:'Review requester fixture',url:'https://example.invalid/review-request'}});expect(requests.filter(r=>r.method==='ui/message')).toHaveLength(1);
});
test('interrupted launch retains the draft and retries only after another explicit submit',async({page})=>{
 const {app}=await open(page);await app.locator('#new-review').click();await page.evaluate(()=>window.__shelobPreview.errors['shelob.start']='Source unavailable. Try again.');await app.locator('#pr-url').fill('https://github.com/example/repo/pull/99');await page.keyboard.press('Enter');await expect(app.getByRole('alert')).toContainText('Source unavailable');await expect(app.locator('#pr-url')).toHaveValue('https://github.com/example/repo/pull/99');await page.evaluate(()=>delete window.__shelobPreview.errors['shelob.start']);await page.keyboard.press('Enter');await expect(app.getByRole('dialog')).toHaveCount(0);
});
test('Settings model and automatic-approval preferences save independently without launching or publishing',async({page})=>{
 const {app,errors}=await open(page);await menu(app,'Settings');await app.locator('#review-model').fill('chosen-model');await app.locator('#save-settings').click();await expect(app.locator('#settings-saved')).toBeVisible();await app.locator('#auto-approve-clean').click();await app.locator('#save-auto-approval').click();await expect(app.getByText('Approval setting saved.',{exact:true})).toBeVisible();await app.locator('#close-settings').click();await menu(app,'Settings');await expect(app.locator('#review-model')).toHaveValue('chosen-model');await expect(app.locator('#auto-approve-clean')).toBeChecked();const requests=await page.evaluate(()=>window.__shelobPreview.requests);expect(requests.some(r=>['shelob.start','shelob.review_post'].includes(r.params?.name)||r.method==='ui/message')).toBe(false);expect(errors).toEqual([]);
});
test('rerun source choices live in a dialog and preserve explicit launch targeting',async({page})=>{
 const {app}=await open(page);await report(page,app);await expect(app.getByRole('radio')).toHaveCount(0);await menu(app,'Rerun review…');await app.getByRole('radio',{name:'Local copy',exact:true}).click();await app.locator('#confirm-rerun').click();await expect(app.getByRole('dialog')).toHaveCount(0);const requests=await page.evaluate(()=>window.__shelobPreview.requests);expect(requests.find(r=>r.params?.name==='shelob.start').params.arguments.reviewMode).toBe('local_copy');expect(requests.filter(r=>r.method==='ui/message')).toHaveLength(1);
});
test('prepared comments, advisory selection and drafts survive checks, refresh and navigation',async({page})=>{
 const {app,errors}=await open(page);await report(page,app);await (await prepare(app)).fill('Keep my edited comment.');await app.locator('#select-comments').click();await expect(app.locator('#selection-count')).toHaveText('2 selected');await app.getByRole('button',{name:'Next check',exact:true}).click();await prepare(app);await expect(app.locator('.check-detail:visible [data-advisory=true]')).toBeVisible();await expect(app.locator('.check-detail:visible [role=checkbox]')).not.toBeChecked();await app.locator('.check-detail:visible [role=checkbox]').click();await expect(app.locator('#selection-count')).toHaveText('3 selected');await app.getByRole('button',{name:'Previous check',exact:true}).click();await app.locator('#refresh').click();await expect(app.locator('#refresh')).toBeEnabled();await expect(app.locator('.check-detail:visible textarea')).toHaveValue('Keep my edited comment.');await app.locator('#home').click();await report(page,app);await expect(app.locator('.check-detail:visible textarea')).toHaveValue('Keep my edited comment.');expect(errors).toEqual([]);
});
test('marking a blocker discussed does not make approval available and can be restored',async({page})=>{
 const {app}=await open(page);await report(page,app,'22345678-1234-4123-8123-123456789abc');await expect(app.locator('#approve-pr')).toHaveCount(0);await expect(app.locator('#review-next')).toHaveText('Review issues');await app.locator('.check-detail:visible').getByRole('button',{name:'Mark as discussed',exact:true}).click();await expect(app.locator('.check-detail:visible').getByRole('button',{name:'Restore comment',exact:true})).toBeVisible();await expect(app.locator('#approve-pr')).toHaveCount(0);await app.locator('.check-detail:visible').getByRole('button',{name:'Restore comment',exact:true}).click();expect(await page.evaluate(()=>window.__shelobPreview.requests.some(r=>r.params?.name==='shelob.review_post'))).toBe(false);
});
test('comment and approval previews retain exact edits and separate explicit confirmations',async({page})=>{
 const {app}=await open(page);await report(page,app);await (await prepare(app)).fill('Exact edit <script> remains text.');await app.locator('.check-detail:visible [role=checkbox]').click();await app.locator('#post-selected').click();const dialog=app.getByRole('dialog',{name:'Post 1 comment?',exact:true});await expect(dialog.locator('.post-body')).toHaveText('Exact edit <script> remains text.');await app.locator('#cancel-post').click();await app.locator('#approve-pr').click();await expect(app.getByRole('dialog',{name:'Approve this PR?',exact:true})).toBeVisible();await app.locator('#cancel-post').click();expect(await page.evaluate(()=>window.__shelobPreview.requests.some(r=>r.params?.name==='shelob.review_post'))).toBe(false);await app.locator('#post-selected').click();await app.locator('#confirm-post').click();await expect(app.getByRole('dialog',{name:'Comments posted',exact:true})).toBeVisible();const posts=await page.evaluate(()=>window.__shelobPreview.requests.filter(r=>r.params?.name==='shelob.review_post'));expect(posts).toHaveLength(1);expect(posts[0].params.arguments.confirmed).toBe(true);
});
test('the inline check list combines search and optional filters and restores focus after closing',async({page})=>{
 const {app}=await open(page);await report(page,app);const dialog=await checks(app);await expect(dialog.locator('#severity')).toHaveCount(0);await dialog.getByRole('button',{name:'Filters',exact:true}).click();await dialog.getByRole('button',{name:'All severities',exact:true}).click();await page.keyboard.press('Escape');await expect(dialog.getByRole('button',{name:'All severities',exact:true})).toBeFocused();await dialog.getByRole('button',{name:'All severities',exact:true}).click();await app.getByText('High · Blocking',{exact:true}).last().click();await expect(dialog.getByText('No checks match these filters.',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Clear filters',exact:true}).click();await dialog.locator('#search').fill('TEST-004');await expect(dialog.locator('.check-row')).toHaveCount(1);await dialog.locator('.check-row').click();await expect(app.locator('.check-detail:visible h2')).toHaveText('Test and CI settings');await expect(app.locator('.check-detail:visible h2')).toBeFocused();
});
test('Rules retain numeric validation, drafts and revision conflicts',async({page})=>{
 const {app}=await open(page);await menu(app,'Rules');await app.locator('[data-rule-id="SCOPE-001"]').getByRole('button',{name:/Edit /}).click();await app.locator('#rule-maxLines').fill('450');await app.locator('#save-rule').click();await app.locator('#add-rule').click();await app.locator('#rule-title').fill('Keep this draft');await app.locator('#rule-rationale').fill('A meaningful rationale.');await app.locator('#rule-instructions').fill('Trace supporting source.');await page.evaluate(()=>window.__shelobPreview.errors['shelob.rule_save']='Rules changed in another window. Reload the rules before saving.');await app.locator('#save-rule').click();await expect(app.locator('#rule-error')).toContainText('changed in another window');await expect(app.locator('#rule-title')).toHaveValue('Keep this draft');await app.locator('#cancel-rule').click();await app.locator('#refresh-history').click();await expect(app.getByRole('heading',{name:'Rules',exact:true})).toBeVisible();
});
test('model rejection promotes the setup action without starting another review',async({page})=>{
 const {app}=await open(page);await report(page,app,'32345678-1234-4123-8123-123456789abc');await expect(app.locator('#review-next')).toHaveText('Choose review model');await app.locator('#review-next').click();await app.locator('#review-model').fill('another-model');await app.locator('#retry-rejected-setup').click();await app.locator('#save-settings').click();await expect(app.locator('#settings-saved')).toBeVisible();const requests=await page.evaluate(()=>window.__shelobPreview.requests);expect(requests.find(r=>r.params?.name==='shelob.settings_save').params.arguments.retryRejectedSetup).toBe(true);expect(requests.some(r=>['shelob.start','shelob.code_review'].includes(r.params?.name))).toBe(false);
});
test('mobile Back restores the selected review and the previous check and draft',async({page})=>{
 await page.setViewportSize({width:390,height:844});const {app,errors}=await open(page);await report(page,app);await expect(app.locator('.review-rail')).not.toBeVisible();await (await prepare(app)).fill('Retain my mobile draft.');await app.getByRole('button',{name:'Next check',exact:true}).click();const title=await app.locator('.check-detail:visible h2').innerText();await app.locator('#back-reviews').click();await expect(app.locator(`[data-run="${firstId}"]`)).toBeFocused();await report(page,app);await expect(app.locator('.check-detail:visible h2')).toHaveText(title);await app.getByRole('button',{name:'Previous check',exact:true}).click();await expect(app.locator('.check-detail:visible textarea')).toHaveValue('Retain my mobile draft.');expect(errors).toEqual([]);await page.screenshot({path:`dist/releases/${version}/mobile.png`,fullPage:true});
});
test('polling preserves the selected check and never starts a review',async({page})=>{
 const {app}=await open(page);await report(page,app);await app.getByRole('button',{name:'Next check',exact:true}).click();const title=await app.locator('.check-detail:visible h2').innerText();await page.evaluate(()=>{const r=window.__shelobPreview.fixture.values[0].report;r.results.unshift({...r.results[0],ruleId:'NEW-001',title:'Earlier check',status:'not_assessed',findings:[]});});await app.locator('#refresh').click();await expect(app.locator('#refresh')).toBeEnabled();await expect(app.locator('.check-detail:visible h2')).toHaveText(title);expect(await page.evaluate(()=>window.__shelobPreview.requests.some(r=>['shelob.start','shelob.code_review'].includes(r.params?.name)))).toBe(false);
});
test('rewriting proposes text without replacing an edited draft or publishing anything',async({page})=>{
 const {app}=await open(page);await report(page,app);await (await prepare(app)).fill('My original draft.');await app.getByRole('button',{name:'Ask Shelob to rewrite',exact:true}).click();await app.locator('.rewrite-request input').fill('Make the risk clear.');await app.getByRole('button',{name:'Prepare rewrite',exact:true}).click();await expect(app.getByText('Waiting for Shelob’s proposed rewrite. Your draft stays editable.',{exact:true})).toBeVisible();await app.locator('.check-detail:visible textarea').fill('A newer user edit.');
 await expect.poll(()=>page.evaluate(()=>window.__shelobPreview.requests.some(r=>r.method==='ui/message'))).toBe(true);
 await page.evaluate(()=>{const state=window.__shelobPreview,request=state.requests.find(r=>r.method==='ui/message');const text=request.params.content[0].text;const args=JSON.parse(text.split('Comment context:\n')[1]);state.fixture.values[0].draftSuggestions=[{...args,id:'proposal-1',draft:'A clearer proposed comment.'}];state.open(args.runId);});
 await expect(app.getByRole('region',{name:'Proposed comment'})).toBeVisible();await expect(app.locator('.check-detail:visible textarea')).toHaveValue('A newer user edit.');await app.getByRole('button',{name:'Apply rewrite',exact:true}).click();await expect(app.locator('.check-detail:visible textarea')).toHaveValue('A clearer proposed comment.');expect(await page.evaluate(()=>window.__shelobPreview.requests.some(r=>['shelob.start','shelob.code_review','shelob.review_post'].includes(r.params?.name)))).toBe(false);
});
test('receipt copy preserves exact sent text',async({page,context})=>{
 await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;}}}));const {app}=await open(page);await page.evaluate(()=>{const v=window.__shelobPreview.fixture.values[0],f=v.report.results.flatMap(r=>r.findings)[0];v.publishing.comments={[f.id]:{state:'posted',draft:'Exact sent text.',url:v.run.source.url+'#receipt'}};});await report(page,app);await expect(app.locator('.check-detail:visible textarea')).toHaveValue('Exact sent text.');await app.locator('.check-detail:visible').getByRole('button',{name:'Copy',exact:true}).click();expect(await app.locator('body').evaluate(()=>window.__copied)).toBe('Exact sent text.');
});
for(const [name,width,theme]of [['desktop-dark',1440,'dark'],['mobile-dark',390,'dark'],['mobile-light',320,'light']])test(`long content fits ${name} with a fixed header and reader`,async({page})=>{
 await page.setViewportSize({width,height:1000});const {app,errors}=await open(page,`?theme=${theme}`);await page.evaluate(()=>window.__shelobPreview.fixture.values[0].report.source.title='A deliberately long title '+('with enough context to wrap '.repeat(8)));await report(page,app);await expect(app.locator('html')).toHaveAttribute('data-theme',theme);expect(await app.locator('html').evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);expect(errors).toEqual([]);await page.screenshot({path:`dist/releases/${version}/${name}.png`,fullPage:true});
});

test('the reader restores its scroll position after visiting another report',async({page})=>{
 const {app}=await open(page);await report(page,app);await prepare(app);await app.locator('.support-section summary').click();const reader=app.locator('.reader-content');await reader.evaluate(el=>{el.scrollTop=220;el.dispatchEvent(new Event('scroll'));});const before=await reader.evaluate(el=>el.scrollTop);expect(before).toBeGreaterThan(0);await report(page,app,'22345678-1234-4123-8123-123456789abc');await report(page,app);expect(await reader.evaluate(el=>el.scrollTop)).toBe(before);
});
test('recorded and uncertain approvals show their receipt action, with no approval retry button',async({page})=>{
 const {app}=await open(page);await page.evaluate(()=>{const v=window.__shelobPreview.fixture.values[0];v.publishing.approval={state:'posted',result:{url:v.run.source.url+'#approval'}};});await report(page,app);await expect(app.getByRole('link',{name:'View approval ↗',exact:true})).toBeVisible();await expect(app.locator('#approve-pr')).toHaveCount(0);await page.evaluate(()=>{const s=window.__shelobPreview;s.fixture.values[0].publishing.approval={state:'unknown'};s.open(s.fixture.values[0].run.id);});await expect(app.getByRole('link',{name:'Check on GitHub ↗',exact:true})).toBeVisible();await expect(app.locator('#approve-pr')).toHaveCount(0);
});
test('local reviews show completion and copy controls without GitHub approval or posting actions',async({page})=>{
 const {app}=await open(page);await page.evaluate(()=>{const v=window.__shelobPreview.fixture.values[0];v.run.source.kind='local';delete v.report.source;});await report(page,app);await expect(app.locator('.review-summary h2')).toHaveText('Review complete');await expect(app.locator('#approve-pr')).toHaveCount(0);await prepare(app);await expect(app.locator('.check-detail:visible').getByRole('button',{name:'Review and send…',exact:true})).toHaveCount(0);await expect(app.locator('.check-detail:visible').getByRole('button',{name:'Copy',exact:true})).toBeVisible();
});
