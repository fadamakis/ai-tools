import type {Task} from './contracts.js';

export const closedTask=(task:Task)=>task.state==='done'||task.state==='dismissed';
export const focusEligible=(task:Task)=>!task.parentId&&(task.state==='ready'||task.state==='in_progress');
export type BranchSummary={open:number;attention:number;closed:number;snoozed:number};
export function taskTree(tasks:readonly Task[]){
  const byId=new Map(tasks.map(task=>[task.id,task]));
  const children=new Map<string,Task[]>();
  for(const task of tasks)if(task.parentId&&byId.has(task.parentId))children.set(task.parentId,[...(children.get(task.parentId)??[]),task]);
  const ancestors=(id:string)=>{
    const result:Task[]=[],seen=new Set([id]);let parent=byId.get(id)?.parentId;
    while(parent&&byId.has(parent)){
      if(seen.has(parent))throw Error('Task hierarchy contains a cycle.');
      seen.add(parent);const task=byId.get(parent)!;result.push(task);parent=task.parentId;
    }
    return result;
  };
  const descendants=(id:string)=>{
    const result:Task[]=[],pending=[...(children.get(id)??[])],seen=new Set([id]);
    for(let index=0;index<pending.length;index++){
      const task=pending[index];if(seen.has(task.id))throw Error('Task hierarchy contains a cycle.');
      seen.add(task.id);result.push(task);pending.push(...(children.get(task.id)??[]));
    }
    return result;
  };
  const summary=(id:string):BranchSummary=>descendants(id).reduce((counts,task)=>{
    if(closedTask(task))counts.closed++;
    else if(task.state==='snoozed')counts.snoozed++;
    else{counts.open++;if(task.ownNeedsAttention)counts.attention++;}
    return counts;
  },{open:0,attention:0,closed:0,snoozed:0});
  const topics=(id:string)=>[...new Set([byId.get(id),...ancestors(id)].flatMap(task=>task?.directTopicIds??[]))];
  const validateMove=(id:string,parentId:string|null)=>{
    if(!byId.has(id))throw Error('Task no longer exists. Refresh the list.');
    if(parentId!==null&&(!byId.has(parentId)||closedTask(byId.get(parentId)!)))throw Error('Choose an existing open parent.');
    if(parentId===id||(parentId&&ancestors(parentId).some(task=>task.id===id)))throw Error('A task cannot be moved into its own branch.');
  };
  return {byId,children,ancestors,descendants,summary,topics,validateMove};
}
export const summaryLabel=(summary:BranchSummary)=>[
  `${summary.open} open${summary.attention?` (${summary.attention} need attention)`:''}`,
  `${summary.closed} closed`,...(summary.snoozed?[`${summary.snoozed} snoozed`]:[]),
].join(' · ');
export type TreeRow={task:Task;depth:number;context:boolean};
export function visibleTaskRows(tasks:readonly Task[],matches:ReadonlySet<string>,expanded:ReadonlySet<string>,showClosed:ReadonlySet<string>,filtered=false):TreeRow[]{
  const tree=taskTree(tasks),included=new Set(matches);
  for(const id of matches)for(const task of tree.ancestors(id))included.add(task.id);
  if(!filtered)for(const id of showClosed)if(included.has(id))for(const task of tree.descendants(id).filter(closedTask))included.add(task.id);
  for(const id of [...included])for(const task of tree.ancestors(id))included.add(task.id);
  const sort=(items:Task[],root=false)=>[...items].sort((a,b)=>root?
    (a.focusOrder??99)-(b.focusOrder??99)||(a.state==='in_progress'?0:1)-(b.state==='in_progress'?0:1)||(a.order??999999)-(b.order??999999)||a.id.localeCompare(b.id):
    Number(!!(b.ownNeedsAttention||tree.summary(b.id).attention))-Number(!!(a.ownNeedsAttention||tree.summary(a.id).attention))||(a.order??999999)-(b.order??999999)||a.id.localeCompare(b.id));
  const pending=sort(tasks.filter(task=>!task.parentId),true).map(task=>({task,depth:0,context:!matches.has(task.id)})).reverse(),rows:TreeRow[]=[];
  while(pending.length){
    const row=pending.pop()!;if(!included.has(row.task.id))continue;rows.push(row);
    if(expanded.has(row.task.id)||filtered){
      const next=sort(tree.children.get(row.task.id)??[]).filter(task=>!closedTask(task)||showClosed.has(row.task.id)||filtered);
      pending.push(...next.map(task=>({task,depth:row.depth+1,context:!matches.has(task.id)})).reverse());
    }
  }
  return rows;
}
