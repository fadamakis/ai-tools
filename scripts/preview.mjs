import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, beforeDemo, weakenDemo } from '../plugins/shelob/tests/fixtures.mjs';
import { createReport } from '../plugins/shelob/scripts/shelob.mjs';
import { renderReport } from '../plugins/shelob/scripts/lib/report.mjs';
import { reviewVerdict } from '../plugins/shelob/assets/report-model.mjs';
import { reviewExecution } from '../plugins/shelob/assets/review-execution.mjs';
import { reviewDecision } from '../plugins/shelob/assets/review-decision.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),plugin=path.join(workspace,'plugins/shelob');
const version=JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'),'utf8')).version;
const output=path.join(workspace,`dist/shelob-${version}-preview`);fs.mkdirSync(output,{recursive:true});
const sample=fixture(beforeDemo);let report;
try{weakenDemo(sample);report=createReport({repo:sample.repo,base:'main',nativeReviewRequired:true});}finally{await sample.cleanup();}
report.repository={...report.repository,name:'example/repository',root:'/example/repository'};
report.source={kind:'github_pr',repository:'example/repository',number:128,url:'https://github.com/example/repository/pull/128',title:'Keep the checkout calculation consistent',author:'example-author',reviewMode:'pr_only',headSha:report.repository.head,baseSha:report.repository.baseCommit};
report.freshness={status:'current',checkedAt:report.generatedAt,message:'Illustrative preview data.'};
report.analysis={...report.analysis,contextual:true,codeReview:{required:true,status:'completed'},execution:{state:'completed',label:'Completed · PR-only',reason:'The selected review steps finished. Coverage and approval readiness are listed separately.'}};
report.results=report.results.map(result=>({...result,status:result.findings.length?'findings':'assessed',reason:result.findings.length?result.reason:'Illustrative completed check. No user repository was reviewed.'}));
const incomplete=structuredClone(report);incomplete.results.find(r=>r.ruleId==='VISUAL-001').status='not_assessed';incomplete.results.find(r=>r.ruleId==='VISUAL-001').reason='Rendered visual evidence was not supplied.';
const changes=structuredClone(report);changes.source={...changes.source,number:129,url:'https://github.com/example/repository/pull/129',title:'Keep permission checks in the request path'};changes.results.find(r=>r.findings.length).findings[0].severity='error';
const failed=structuredClone(report);failed.source={...failed.source,number:130,url:'https://github.com/example/repository/pull/130',title:'Review the sign-in recovery flow'};failed.analysis.execution={state:'failed',label:'Failed · PR-only',reason:'Native review could not finish.'};failed.analysis.codeReview.status='failed';failed.results.find(r=>r.ruleId==='CODEX-REVIEW').status='not_assessed';failed.results.find(r=>r.ruleId==='CODEX-REVIEW').reason='Codex CLI does not support the configured model example-model for this account.';
const ids=['12345678-1234-4123-8123-123456789abc','22345678-1234-4123-8123-123456789abc','32345678-1234-4123-8123-123456789abc','42345678-1234-4123-8123-123456789abc'];
const values=[report,changes,failed,incomplete].map((report,index)=>({run:{id:ids[index],state:'complete',source:report.source},report,publishing:{},request:{kind:'github_pr',url:report.source.url,reviewMode:'pr_only'},createdAt:new Date(Date.parse(report.generatedAt)-index*3600000).toISOString()}));
function history(){return values.map(({run,report,createdAt,publishing})=>({id:run.id,title:`${run.source.repository} #${run.source.number}`,source:run.source,state:run.state,createdAt,reviewKey:run.source.url,execution:reviewExecution(report,{runState:run.state}),verdict:reviewVerdict(report.results,{report,runState:run.state}),decision:reviewDecision(report,{verdict:reviewVerdict(report.results,{report,runState:run.state}),execution:reviewExecution(report,{runState:run.state}),publishing})}));}
const data={values,reviews:history(),rules:{pack:JSON.parse(fs.readFileSync(path.join(plugin,'rules/baseline.json'),'utf8')),revision:'a'.repeat(64),customized:false}};
fs.writeFileSync(path.join(output,'fixture.json'),JSON.stringify(data,null,2)+'\n');
const fixtureData=JSON.stringify(data).replaceAll('<','\\u003c');
const host=`
const fixture=${fixtureData};
let policy={enabled:false,revision:'e'.repeat(64)},settings={model:null,revision:'c'.repeat(64)},rules=fixture.rules,selected=fixture.values[0];
window.__shelobPreview={requests:[],openedLinks:[],fixture,settings,errors:{},hold:{},entrypoint:new URLSearchParams(location.search).get('entrypoint')||'global'};
const state=window.__shelobPreview,frame=document.querySelector('iframe');
function send(value){frame.contentWindow.postMessage({jsonrpc:'2.0',...value},'*');}
state.notify=(method,params)=>send({method,params});
state.open=id=>{selected=fixture.values.find(v=>v.run.id===id)||selected;send({method:'ui/notifications/tool-result',params:present(selected)});};
function present(value){return {structuredContent:{run:value.run,report:value.report},_meta:{report:value.report,publishing:value.publishing,request:value.request,draftSuggestions:value.draftSuggestions||[]},content:[]};}
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||!event.data?.jsonrpc)return;
 const request=event.data;state.requests.push(request);if(request.id===undefined)return;
 let result={};
 if(request.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'Shelob sandbox preview',version:'1'},hostCapabilities:{openLinks:{},message:{text:{}},experimental:new URLSearchParams(location.search).has('noMessages')?{}:{'openai/message':{},'openai/model-context':{},'openai/files':{}}},hostContext:{theme:new URLSearchParams(location.search).get('theme')||'light',displayMode:'fullscreen'}};
 if(request.method==='ui/open-link')state.openedLinks.push(request.params.url);
 if(request.method==='tools/call'){
  const {name,arguments:args}=request.params;
  if(state.hold[name])await new Promise(resolve=>{state.release=resolve;});
  if(state.errors[name])result={isError:true,content:[{type:'text',text:state.errors[name]}]};
  else if(name==='shelob.list')result={structuredContent:{reviews:fixture.reviews},content:[]};
  else if(name==='shelob.get'){selected=fixture.values.find(v=>v.run.id===args.runId)||selected;result=present(selected);}
  else if(name==='shelob.start'){selected={...fixture.values[0],request:args,run:{...fixture.values[0].run,state:'awaiting_review',source:{...fixture.values[0].run.source,url:args.url,reviewMode:args.reviewMode}}};result=present(selected);}
  else if(name==='shelob.approval_policy')result={structuredContent:policy,content:[]};
  else if(name==='shelob.approval_policy_save'){policy={enabled:args.enabled,revision:'f'.repeat(64)};result={structuredContent:policy,content:[]};}
  else if(name==='shelob.settings')result={structuredContent:settings,content:[]};
  else if(name==='shelob.settings_save'){settings={model:args.model,revision:'d'.repeat(64)};state.settings=settings;result={structuredContent:settings,content:[]};}
  else if(name==='shelob.rules')result={structuredContent:rules,content:[]};
  else if(name==='shelob.rule_save'){rules={...rules,revision:'b'.repeat(64),customized:true,pack:{...rules.pack,rules:args.originalId?rules.pack.rules.map(r=>r.id===args.originalId?args.rule:r):[...rules.pack.rules,args.rule]}};result={structuredContent:rules,content:[]};}
  else if(name==='shelob.comment_discussed'){selected.publishing.discussed=args.discussed?[...new Set([...(selected.publishing.discussed||[]),args.findingId])]:(selected.publishing.discussed||[]).filter(id=>id!==args.findingId);result={structuredContent:selected.publishing,content:[]};}
  else if(name==='shelob.review_preview')result={structuredContent:{id:'52345678-1234-4123-8123-123456789abc',url:selected.run.source.url,event:args.event,count:args.comments.length,payload:{body:args.comments.map(c=>c.draft).join('\\n\\n'),comments:[]}},content:[]};
  else if(name==='shelob.review_post'){result={structuredContent:{id:123,url:selected.run.source.url+'#preview-receipt',state:'COMMENTED'},content:[]};}
  else result={isError:true,content:[{type:'text',text:'Unsupported preview action'}]};
 }
 send({id:request.id,result});
 if(request.method==='ui/initialize')queueMicrotask(()=>send({method:'ui/notifications/tool-result',params:{structuredContent:{entrypoint:state.entrypoint,reviews:fixture.reviews},content:[]}}));
});
`;
fs.copyFileSync(path.join(plugin,'app/dist/index.html'),path.join(output,'app.html'));
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shelob · Design preview</title><style>html,body{margin:0;height:100%;font:12px system-ui}body{display:flex;flex-direction:column}aside{padding:8px 16px;border-bottom:1px solid #ddd;color:#666;display:flex;align-items:center;gap:16px}aside a{color:inherit}iframe{border:0;width:100%;flex:1;min-height:0}</style></head><body><aside>Design preview · Example data · No GitHub actions<a href="?theme=light">Light</a><a href="?theme=dark">Dark</a><a href="standalone/report.html">HTML export</a></aside><iframe title="Shelob" src="app.html" sandbox="allow-scripts"></iframe><script>${host.replaceAll('</script','<\\/script')}</script></body></html>`);
for(const [name,value] of [['standalone',report],['incomplete',incomplete],['changes',changes]]){const folder=path.join(output,name);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'report.html'),renderReport(value));fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(value,null,2)+'\n');}
console.log(JSON.stringify({version,preview:path.join(output,'index.html'),standalone:path.join(output,'standalone/report.html')},null,2));
