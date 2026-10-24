export function reviewAction({decision,run,isPr,nativeRunning=false}){
  if(decision.setupFailed)return {kind:'settings',label:'Choose review model'};
  if(decision.state==='uncertain')return {kind:'github',label:'Check on GitHub'};
  if(decision.state==='approved')return {kind:'receipt',label:'View approval'};
  if(run?.requiresRerun||decision.state==='stale')return {kind:'continue',label:'Start fresh review'};
  if(['failed','interrupted'].includes(decision.execution.state))return {kind:'continue',label:'Retry review'};
  if(nativeRunning)return {kind:'running',label:'Review in progress'};
  if(decision.state==='incomplete'&&run?.state==='complete')return {kind:'continue',label:'Start fresh review'};
  if(['incomplete','progress'].includes(decision.state))return {kind:'continue',label:run?.state==='preparing'?'Reading changes…':'Continue review'};
  if(decision.state==='changes')return {kind:'issues',label:'Review issues'};
  return isPr?{kind:'approve',label:'Approve PR…'}:{kind:'issues',label:decision.comments?.optional||decision.comments?.required?'Review notes':'View checks'};
}
