import { McpServer } from '@modelcontextprotocol/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { upsertSchema, decisionSchema, personalTaskSchema, syncSchema, configureSyncSchema,localTriggerSchema,linkDiscussionSchema,saveDiscussionSchema } from '../shared/contracts.js';
import { SauronStore } from './store.js';
import { invoke } from './service.js';
import { fileURLToPath } from 'node:url';
import { replyTaskSchema,prepareReplySchema,saveReplySchema,sendReplySchema } from '../shared/replies.js';
import {discussionConversationUrl} from './discussion-context.js';

// Keep the entrypoint address readable by already-running pre-update servers.
export const UI_URI = 'ui://attention/list-v1';
export function createServer(store: SauronStore, htmlPath: string) {
  const icon={src:'data:image/svg+xml;base64,'+readFileSync(fileURLToPath(new URL('../../assets/sidebar-icon.svg',import.meta.url))).toString('base64'), mimeType:'image/svg+xml',sizes:['any']};
  const server = new McpServer({name:'sauron-local-prototype', version:JSON.parse(readFileSync(new URL('../../plugin.json',import.meta.url),'utf8')).version, icons:[icon]});
  new OpenAIExtensions(server);
  for(const uri of [UI_URI,'ui://attention/list-v0.6.6','ui://attention/list-v0.6.5','ui://attention/list-v0.6.4','ui://attention/list-v0.6.3','ui://attention/list-v0.6.2','ui://attention/list-v0.6.1','ui://attention/list-v0.6.0','ui://attention/list-v0.5.0','ui://attention/list-v0.4.2','ui://attention/list-v0.4.1','ui://attention/list-v0.4.0','ui://attention/list-v0.3.1'])server.registerResource('attention-view-'+uri, uri,
    {title:'Sauron', mimeType:'text/html;profile=mcp-app'}, async () => ({contents:[{
      uri, mimeType:'text/html;profile=mcp-app', text:readFileSync(htmlPath, 'utf8'),
      _meta:{ui:{csp:{connectDomains:[], resourceDomains:[]}}, 'openai/ui':{
        preferredDisplayMode:'fullscreen', availableDisplayModes:['fullscreen'],
      }},
    }]}));
  const readOnly = {readOnlyHint:true, destructiveHint:false, openWorldHint:false};
  const definitions = [
    {name:'open_attention', title:'Sauron', description:'Open your saved tasks, latest five-source Dot sync and independent manual check status.',
      icons:[icon],
      inputSchema:z.strictObject({}), annotations:readOnly,
      _meta:{ui:{resourceUri:UI_URI, visibility:['app']}, 'openai/ui':{entrypoints:[{type:'global'}]}}},
    {name:'list_attention', title:'Read Sauron', description:'Read saved tasks, manual scan status, and dot sync status including lastSuccessAt. Read before a dot sync and compare storeId.',
      inputSchema:z.strictObject({}), annotations:readOnly, _meta:{ui:{visibility:['app','model']}}},
    {name:'link_attention_discussion',title:'Link this chat to a Sauron item',description:'Save a durable link from a Sauron item to the CURRENT conversation, using per-call host identity metadata. Use at the start of a discussion opened from Sauron. Does not change task decisions, read sources or send messages. Never guess a conversation ID; if this host omits identity, ask the user to paste their chat link through Link a chat on the item.',
      inputSchema:linkDiscussionSchema,annotations:{...readOnly,readOnlyHint:false,idempotentHint:true},_meta:{ui:{visibility:['app','model']}}},
    {name:'save_attention_discussion_link',title:'Save a pasted conversation link',description:'Save the ChatGPT or Codex conversation URL the user pasted on this Sauron item. Changes only its saved discussion links.',
      inputSchema:saveDiscussionSchema,annotations:{...readOnly,readOnlyHint:false,idempotentHint:true},_meta:{ui:{visibility:['app']}}},
    {name:'refresh_attention', title:'Check what needs attention', description:'Start a live read-only Slack and Granola attention check using the user’s existing desktop connections. Returns immediately with scan status; poll list_attention until scan.status is completed, partial or failed. Concurrent calls join the active check. Writes only the local attention list and preserves user decisions.',
      inputSchema:z.strictObject({}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true},_meta:{ui:{visibility:['app','model']}}},
    {name:'check_scheduled_attention',title:'Run scheduled Sauron check',description:'Respect the persistent automatic-update mode. In dot-managed mode only read saved dot sync freshness; never initiate an independent source scan. In independent mode start or join the legacy Slack/Granola scan. Manual refresh_attention is unchanged.',
      inputSchema:z.strictObject({}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true},_meta:{ui:{visibility:['app','model']}}},
    {name:'check_local_attention',title:'Check local update availability',description:'Gated local coordinator trigger. It runs only in local_managed mode, shares ownership and the source-run lease, and never starts another automatic writer.',
      inputSchema:localTriggerSchema,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true},_meta:{ui:{visibility:['app']}}},
    {name:'configure_attention_sync',title:'Set Sauron automatic-update mode',description:'Persist this app’s dot_managed or independent automatic-update mode. Requires matching store ID and stable operation ID. Dot-managed mode makes legacy scheduled checks read-only; manual Refresh remains available. Does not edit platform schedules. Refuses activation while a source scan is running.',
      inputSchema:configureSyncSchema,annotations:{...readOnly,readOnlyHint:false,idempotentHint:true},_meta:{ui:{visibility:['app','model']}}},
    {name:'get_attention_sync_receipt',title:'Read verified source-sync receipt',description:'Read a committed run digest, result and checkpoint receipt without starting a source scan. Requires the expected store ID.',
      inputSchema:z.strictObject({expectedStoreId:z.string().uuid(),runId:z.string().uuid()}),annotations:readOnly,_meta:{ui:{visibility:['app','model']}}},
    {name:'sync_attention', title:'Sync dot observations', description:'Start, finish, or fail a source-backed dot sync in this local store. Requires matching expectedStoreId and one stable runId. Finish takes actual source coverage and evidence for Slack, Granola, Jira, GitHub and Google Calendar. Derives stable task identities and preserves all user decisions. Does not read sources or start a scanner. Report partial/error honestly; no source absence deletes tasks.',
      inputSchema:syncSchema, annotations:{...readOnly,readOnlyHint:false,idempotentHint:true},_meta:{ui:{visibility:['app','model']}}},
    {name:'upsert_attention_items', title:'Record attention items', description:'Record explicit source-backed Slack/Granola/Jira/GitHub/Calendar observations or synthetic samples. Prefer sync_attention for dot-fed updates with coverage and server-derived identities. Preserves all user decisions. Stable batch IDs deduplicate retries.',
      inputSchema:upsertSchema, annotations:{...readOnly, readOnlyHint:false, idempotentHint:true}, _meta:{ui:{visibility:['app','model']}}},
    {name:'decide_attention_item', title:'Save Sauron decision', description:'Complete, snooze, dismiss, or explicitly reopen a personal or source task in this list only. Requires the displayed version and a stable operation ID.',
      inputSchema:decisionSchema, annotations:{...readOnly, readOnlyHint:false, idempotentHint:true}, _meta:{ui:{visibility:['app']}}},
    {name:'create_personal_task', title:'Add personal task', description:'Save a user-entered task in this local list. A stable operation ID deduplicates retries. No source checks or external writes.',
      inputSchema:personalTaskSchema, annotations:{...readOnly, readOnlyHint:false, idempotentHint:true}, _meta:{ui:{visibility:['app']}}},
    {name:'get_slack_reply',title:'Read reply draft',description:'Read a saved local Slack reply and preparation or delivery status.',
      inputSchema:replyTaskSchema,annotations:readOnly,_meta:{ui:{visibility:['app']}}},
    {name:'prepare_slack_reply',title:'Prepare Slack reply',description:'Read the original Slack discussion and prepare an editable local draft. Does not send or create an external Slack draft. Poll get_slack_reply while preparing.',
      inputSchema:prepareReplySchema,annotations:{...readOnly,readOnlyHint:false,openWorldHint:true},_meta:{ui:{visibility:['app']}}},
    {name:'save_slack_reply',title:'Save reply draft',description:'Save edited reply text locally. No Slack write.',
      inputSchema:saveReplySchema,annotations:{...readOnly,readOnlyHint:false},_meta:{ui:{visibility:['app']}}},
    {name:'send_slack_reply',title:'Send reviewed reply to Slack',description:'Send the exact reviewed text to the server-bound original Slack thread ONLY after the user clicks Send to Slack. A stable operation ID prevents repeated dispatch. Poll get_slack_reply. An unconfirmed outcome is never automatically retried. Does not complete the task.',
      inputSchema:sendReplySchema,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true,idempotentHint:true},_meta:{ui:{visibility:['app']}}},
  ];
  for (const definition of definitions) {
    const {name, ...config} = definition;
    server.registerTool(name, config, async (args: unknown,context) => {
      try {
        const data=invoke(store,name,args,name==='link_attention_discussion'?{conversationUrl:discussionConversationUrl(context.mcpReq._meta)}:undefined);
        // Linking a chat does not need to disclose the rest of the user's list
        // to that conversation. App-only saves retain the normal full UI view.
        const response=name==='link_attention_discussion'?{storeId:data.storeId,discussion:data.discussion,receipt:data.receipt}:data;
        return {content:[{type:'text' as const,text:JSON.stringify(response)}], structuredContent:{...response}};
      } catch(error) {
        return {isError:true, content:[{type:'text' as const,text:error instanceof Error ? error.message : 'Save failed'}]};
      }
    });
  }
  return server;
}
