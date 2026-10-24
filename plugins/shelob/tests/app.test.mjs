import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ShelobController } from '../app/controller.mjs';
import { applyContext, reviewMessage, reviewRoute, sendReview } from '../app/bridge.mjs';
import { groupReviews, recoveryMessage } from '../app/model.mjs';
const id='12345678-1234-4123-8123-123456789abc',other='22345678-1234-4123-8123-123456789abc';
function value(runId=id,{state='awaiting_review',kind='github_pr',requiresRerun=false}={}){
 const source={kind,...kind==='github_pr'?{url:'https://github.com/example/repo/pull/1',reviewMode:'pr_only'}:{}};
 return {structuredContent:{run:{id:runId,state,source,requiresRerun},report:{snapshot:{id:'a'.repeat(64)},results:[]}},_meta:{request:kind==='github_pr'?{kind,url:source.url,reviewMode:'pr_only',rules:'/explicit/rules.json'}:{kind,repo:'/example/repo',base:'main'},publishing:{}}};
}
function setup(t,handler){
 const dom=new JSDOM('<html><body></body></html>');const previous=globalThis.document;globalThis.document=dom.window.document;
 const requests=[],messages=[],contexts=[];
 const app={addEventListener(){},connect:async()=>{},getHostContext:()=>({theme:'dark'}),callServerTool:async request=>{requests.push(request);return handler?.(request)|| (request.name==='shelob.list'?{structuredContent:{reviews:[]}}:request.name==='shelob.settings'?{structuredContent:{model:null,revision:'c'.repeat(64)}}:value());}};
 const vm=new ShelobController(app,{message:{send:async message=>messages.push(message)},modelContext:{update:async context=>contexts.push(context)}},{applyDocumentTheme(){},applyHostStyleVariables(){}});
 t.after(async()=>{await app.onteardown();dom.window.close();globalThis.document=previous;});
 return {vm,app,requests,messages,contexts};
}
test('bridge preserves host appearance, safe areas and validated review routes',async()=>{
 const dom=new JSDOM('<html><body></body></html>');const calls=[];
 applyContext(dom.window.document,{theme:'dark',styles:{variables:{'--color-text-primary':'#eee'}},safeAreaInsets:{top:20,bottom:8}},{applyDocumentTheme:value=>calls.push(value),applyHostStyleVariables:value=>calls.push(value)});
 assert.equal(dom.window.document.documentElement.dataset.theme,'dark');assert.equal(dom.window.document.documentElement.style.getPropertyValue('--safe-top'),'20px');assert.equal(calls.length,2);
 assert.equal(reviewRoute({'openai/deepLink':{url:`/reviews/${id}`}}),id);assert.equal(reviewRoute({'openai/deepLink':{url:'/reviews/../etc/passwd'}}),null);
 await assert.rejects(sendReview(undefined,'review','new'),/cannot start reviews/);dom.window.close();
});
test('connect loads history once, updates context, and never launches a review',async t=>{
 const {vm,requests,contexts,messages}=setup(t);await vm.connect();assert.equal(vm.connected,true);assert.deepEqual(requests.map(r=>r.name),['shelob.list']);assert.equal(contexts.at(-1).structuredContent.page,'history');assert.equal(messages.length,0);
});
test('new PR reviews pin source mode and explicit rules and open a new conversation',async t=>{
 const {vm,requests,messages}=setup(t);vm.newDraft={url:' https://github.com/example/repo/pull/1 ',rules:'/explicit/rules.json',reviewMode:'local_copy'};await vm.action(()=>vm.start());
 assert.deepEqual(requests[0].arguments,{kind:'github_pr',url:'https://github.com/example/repo/pull/1',rules:'/explicit/rules.json',reviewMode:'local_copy'});assert.equal(messages[0]._meta['openai/message'].target,'new');assert.match(messages[0].content[0].text,/Saved review ID/);assert.equal(vm.modal,null);
});
test('failed launch keeps its draft and concurrent clicks cannot start twice',async t=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const {vm,requests}=setup(t,async request=>{if(request.name==='shelob.start'){await pending;return {isError:true,content:[{type:'text',text:'Source unavailable'}]};}});
 vm.newDraft.url='https://github.com/example/repo/pull/1';vm.newReview();const work=vm.action(()=>vm.start());await vm.action(()=>vm.start());assert.equal(requests.length,1);release();await work;assert.match(vm.error,/Source unavailable/);assert.equal(vm.modal.kind,'new');assert.match(vm.newDraft.url,/pull\/1/);assert.equal(vm.busy,false);
});
test('review requests retain the requester and original request link in the launch and conversation',async t=>{
 const {vm,requests,messages}=setup(t);
 const requester={name:'Example Reviewer',url:'https://example.slack.com/archives/C123/p1792313076000000'};
 vm.newDraft={url:'https://github.com/example/repo/pull/1',rules:'',reviewMode:'pr_only',requesterName:' Example Reviewer ',requestUrl:requester.url};
 await vm.start();
 assert.deepEqual(requests[0].arguments.requester,requester);
 assert.match(messages[0].content[0].text,/Example Reviewer/);
 assert.ok(messages[0].content[0].text.includes(requester.url));
 assert.equal(vm.newDraft.requesterName,'');
 assert.equal(vm.newDraft.requestUrl,'');
 const saved=value();saved._meta.request.requester=requester;saved.structuredContent.run.source.requester=requester;
 vm.consume(saved);await vm.launch('local_copy');
 assert.deepEqual(requests.filter(request=>request.name==='shelob.start').at(-1).arguments.requester,requester);
});
test('a request link without a requester name does not start a review',async t=>{
 const {vm,requests}=setup(t);vm.newDraft.url='https://github.com/example/repo/pull/1';vm.newDraft.requestUrl='https://example.com/request';
 await assert.rejects(vm.start(),/name of the person/);assert.equal(requests.length,0);
});
test('local review and a continued current-thread review stay in the active conversation',async t=>{
 const {vm,messages,requests}=setup(t);await vm.local();assert.equal(messages[0]._meta['openai/message'].target,'active');assert.match(messages[0].content[0].text,/working conversation/);
 vm.consume({...value(),structuredContent:{...value().structuredContent,entrypoint:'thread'}},true);await vm.launch('pr_only');assert.equal(messages[1]._meta['openai/message'].target,'active');assert.equal(requests.length,0);
});
test('history continuation targets a new chat; mode switches and legacy snapshots start a fresh pinned review',async t=>{
 const {vm,requests,messages}=setup(t);vm.consume(value(other));await vm.launch('pr_only');assert.equal(messages[0]._meta['openai/message'].target,'new');assert.equal(requests.length,0);
 await vm.launch('local_copy');assert.equal(requests[0].name,'shelob.start');assert.equal(requests[0].arguments.reviewMode,'local_copy');assert.equal(requests[0].arguments.rules,'/explicit/rules.json');
 vm.consume(value(id,{requiresRerun:true}));await vm.launch('pr_only');assert.equal(requests.filter(request=>request.name==='shelob.start').length,2);assert.equal(messages.at(-1)._meta['openai/message'].target,'new');
});
test('rerunning local changes preserves its request and current conversation',async t=>{
 const {vm,requests,messages}=setup(t);const result=value(id,{kind:'local',state:'complete'});result.structuredContent.entrypoint='thread';vm.consume(result,true);await vm.launch();assert.deepEqual(requests[0].arguments,{kind:'local',repo:'/example/repo',base:'main'});assert.equal(messages[0]._meta['openai/message'].target,'active');
});
test('a sidebar launch and navigation invalidate older pending responses',async t=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const {vm}=setup(t,request=>request.name==='shelob.get'?pending:undefined);
 const work=vm.loadRun(id);vm.consume({structuredContent:{entrypoint:'global',reviews:[]}},true);release(value());await work;assert.equal(vm.selected,null);assert.equal(vm.page,'reviews');
});
test('a late rules response cannot replace a newly selected report',async t=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const {vm}=setup(t,request=>request.name==='shelob.rules'?pending:undefined);
 const work=vm.rules();await vm.loadRun(id);release({structuredContent:{revision:'b'.repeat(64),pack:{rules:[]}}});await work;assert.equal(vm.page,'reviews');assert.equal(vm.selected.run.id,id);
});
test('snapshot-bound sessions preserve filters, edits and selection through refresh and navigation',async t=>{
 const {vm}=setup(t);vm.consume(value());const session=vm.session();Object.assign(session,{query:'test',category:'Tests',severity:'warning',check:'TEST-001',drafts:{one:'Unsent edit'},chosen:['one']});
 await vm.loadRun(id);assert.equal(vm.session(),session);await vm.home();vm.consume(value());assert.deepEqual(vm.session().drafts,{one:'Unsent edit'});assert.deepEqual(vm.session().chosen,['one']);
 const next=value();next.structuredContent.report.snapshot.id='b'.repeat(64);vm.consume(next);assert.notEqual(vm.session(),session);assert.deepEqual(vm.session().chosen,[]);
});
test('Settings and discussion controls use only their dedicated app tools',async t=>{
 const {vm,requests,messages}=setup(t);await vm.settings();assert.equal(vm.modal.kind,'settings');vm.consume(value());await vm.discuss('TEST-001:finding',true);assert.deepEqual(requests.map(r=>r.name),['shelob.settings','shelob.approval_policy','shelob.comment_discussed','shelob.get']);assert.equal(requests[2].arguments.snapshotId,'a'.repeat(64));assert.equal(messages.length,0);
});
test('publication starts with an exact preview and never posts or approves on its own',async t=>{
 const {vm,requests,messages}=setup(t,request=>request.name==='shelob.review_preview'?{structuredContent:{id:'preview',event:request.arguments.event,payload:{body:'Exact edited comment'},count:1}}:undefined);
 vm.consume(value(id,{state:'complete'}));const comments=[{findingId:'one',draft:'Exact edited comment'}];await vm.prepareReview('COMMENT',comments);assert.deepEqual(requests[0].arguments,{runId:id,event:'COMMENT',comments});assert.equal(vm.modal.kind,'post');assert.equal(requests.length,1);assert.equal(messages.length,0);
});
test('history groups retries without losing reports; recovery guidance distinguishes source failures',()=>{
 const runs=[{id:'older',source:{url:'https://github.com/example/repo/pull/1/'},createdAt:'2026-10-18T00:00:00Z'},{id:'newer',source:{url:'https://github.com/example/repo/pull/1'},createdAt:'2026-10-19T00:00:00Z'},{id:'local',reviewKey:'local-branch',createdAt:'2026-10-19T01:00:00Z'}];
 assert.deepEqual(groupReviews(runs).map(group=>group.map(r=>r.id)),[['local'],['newer','older']]);assert.match(recoveryMessage({state:'failed',error:'fetch failed: timed out'}),/PR diff without a local copy/);assert.match(recoveryMessage({state:'interrupted'}),/fresh review/);assert.match(reviewMessage({id,source:{url:'example'}}),/shelob.code_review/);
});

test('rewrite requests target the proper conversation and proposals never overwrite an edited draft',async t=>{
 const {vm,messages,requests}=setup(t);const result=value(id,{state:'complete'});result.structuredContent.report.results=[{findings:[{id:'finding-1',title:'Evidence',evidence:[]}]}];vm.consume(result);
 const session=vm.session();session.drafts['finding-1']='My initial draft';await vm.action(()=>vm.rewrite({findingId:'finding-1',draft:'My initial draft',instruction:'Make it clearer'}));
 assert.equal(messages[0]._meta['openai/message'].target,'new');assert.match(messages[0].content[0].text,/shelob.suggest_comment/);assert.equal(requests.length,0);const requestId=session.pendingRewrite.requestId;session.drafts['finding-1']='A newer edit';
 const proposal={id:'proposal',requestId,runId:id,snapshotId:result.structuredContent.report.snapshot.id,findingId:'finding-1',originalDraft:'My initial draft',draft:'Proposed text'};
 vm.consume({_meta:{draftSuggestions:[{...proposal,requestId:'older-request',draft:'Older proposal'}]}});assert.ok(session.pendingRewrite);assert.equal(session.suggestions['finding-1'],undefined);
 vm.consume({_meta:{draftSuggestions:[proposal]}},true);assert.equal(session.drafts['finding-1'],'A newer edit');assert.equal(session.suggestions['finding-1'].draft,'Proposed text');assert.equal(session.pendingRewrite,undefined);assert.equal(vm.selected.run.id,id);
});
test('returning to the rail keeps the selected report and polling does not reopen mobile reading',async t=>{
 const {vm}=setup(t);vm.consume(value());await vm.home();assert.equal(vm.selected.run.id,id);assert.equal(vm.readingReview,false);await vm.loadRun(id,{open:false});assert.equal(vm.readingReview,false);await vm.loadRun(id);assert.equal(vm.readingReview,true);
});
test('a receipt updates the persistent history row without waiting for another history refresh',async t=>{
 const {vm}=setup(t),result=value(id,{state:'complete'});vm.reviews=[{id,title:'Existing review',createdAt:'2026-10-19T00:00:00Z'}];vm.consume({...result,_meta:{...result._meta,publishing:{approval:{state:'posted',result:{url:'https://github.com/example/repo/pull/1#approval'}}}}});assert.equal(vm.reviews[0].decision.state,'approved');assert.equal(vm.reviews[0].title,'Existing review');
});

test('the global sidebar refreshes external run completion without starting or selecting a review',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const completed={id,state:'complete',createdAt:'2026-10-19T00:00:00Z',source:{kind:'github_pr'},execution:{state:'failed',label:'Failed · PR-only'}};
 const {vm,requests,messages}=setup(t,request=>request.name==='shelob.list'?{structuredContent:{reviews:[completed]}}:undefined);
 Object.defineProperty(document,'hidden',{value:false,configurable:true});
 vm.connected=true;vm.reviews=[{...completed,state:'awaiting_review',execution:{state:'pending'}}];vm.schedule();
 t.mock.timers.tick(3000);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(vm.reviews[0].state,'complete');assert.equal(vm.reviews[0].execution.state,'failed');assert.equal(vm.selected,null);
 assert.deepEqual(requests.map(request=>request.name),['shelob.list']);assert.equal(messages.length,0);
});

test('a late history response after app teardown cannot restart polling',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release;
 const pending=new Promise(resolve=>{release=resolve;});
 const {vm,app,requests}=setup(t,request=>request.name==='shelob.list'?pending:undefined);
 Object.defineProperty(document,'hidden',{value:false,configurable:true});vm.connected=true;vm.reviews=[{id,state:'awaiting_review'}];vm.schedule();
 t.mock.timers.tick(3000);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,1);
 await app.onteardown();release({structuredContent:{reviews:[]}});await new Promise(resolve=>setImmediate(resolve));
 t.mock.timers.tick(15000);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,1);assert.equal(vm.connected,false);
});
