import type {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import type {Task} from '../shared/contracts.js';
import type {TaskOrganisation,Topic} from '../shared/organisation.js';

export const taskEvidence=(task:Task)=>createHash('sha256').update(JSON.stringify([task.sourceTitle??task.title,task.sourceNextAction??task.nextAction,task.sourceState,'resolved' in task?task.resolved:false])).digest('hex');
export class OrganisationStore{
  constructor(private db:DatabaseSync){}
  private read<T>(key:string,fallback:T):T{const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);return row?JSON.parse(row.value as string) as T:fallback;}
  private write(key:string,value:unknown){this.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  revision(){return this.read('task_view_revision',0);}
  touch(){this.write('task_view_revision',this.revision()+1);}
  get(task:Task):TaskOrganisation{return this.read('task-organisation:'+task.id,{parentId:null,directTopicIds:[],attention:task.sourceState==='needs_you'&&!task.userDecision,handledEvidence:null,evidence:taskEvidence(task),reopenSuggested:false,sourceClosed:'resolved' in task&&task.resolved});}
  save(task:Task,value:TaskOrganisation){this.write('task-organisation:'+task.id,value);this.touch();}
  observe(task:Task){
    const previous=this.get(task),evidence=taskEvidence(task);
    if(previous.evidence===evidence)return;
    this.save(task,{...previous,evidence,sourceClosed:previous.sourceClosed||('resolved' in task&&task.resolved),attention:previous.attention||task.sourceState==='needs_you',
      reopenSuggested:previous.reopenSuggested||((previous.sourceClosed||task.userDecision==='complete'||task.userDecision==='dismiss')&&task.sourceState==='needs_you')});
  }
  topics():Topic[]{return this.read('organisation_topics',[]);}
  assignTopics(names:string[]):string[]{
    const topics=this.topics(),ids:string[]=[];
    for(const name of names){let topic=topics.find(item=>item.name.toLocaleLowerCase()===name.toLocaleLowerCase());
      if(!topic){topic={id:randomUUID(),name};topics.push(topic);}if(!ids.includes(topic.id))ids.push(topic.id);
    }
    this.write('organisation_topics',topics);return ids;
  }
}
