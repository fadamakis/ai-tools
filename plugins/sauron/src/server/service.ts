import { SauronStore, StoreError } from './store.js';
import type { Result } from '../shared/contracts.js';
import { refreshAttention } from './scan.js';
import { checkLocalAttention } from './local-update.js';
import { z } from 'zod';
import { getReply,prepareReply,sendReply } from './reply.js';
import {linkDiscussionSchema} from '../shared/contracts.js';

export function invoke(store: SauronStore, name: string, args: unknown,context?:{conversationUrl?:string}): Result {
  switch(name) {
    case 'open_attention':
    case 'list_attention': z.strictObject({}).parse(args); return store.view();
    case 'link_attention_discussion': {
      const request=linkDiscussionSchema.parse(args);
      if(!context?.conversationUrl)throw new StoreError('conversation_context_missing','This host did not provide the current chat identity. Copy this chat’s link and use Link a chat on the Sauron item.');
      return store.saveDiscussion({...request,url:context.conversationUrl});
    }
    case 'save_attention_discussion_link': return store.saveDiscussion(args);
    case 'refresh_attention': z.strictObject({}).parse(args); return refreshAttention(store);
    case 'check_scheduled_attention': z.strictObject({}).parse(args); return refreshAttention(store,true);
    case 'check_local_attention': return checkLocalAttention(store,args);
    case 'configure_attention_sync': return store.configureSync(args);
    case 'get_attention_sync_receipt': {
      const request=z.strictObject({expectedStoreId:z.string().uuid(),runId:z.string().uuid()}).parse(args);
      if(request.expectedStoreId!==store.storeId)throw new StoreError('wrong_store','Store ID does not match.');
      return {...store.view(),syncReceipt:store.syncReceipt(request.runId)};
    }
    case 'sync_attention': return store.syncAttention(args);
    case 'upsert_attention_items': return store.upsert(args);
    case 'create_personal_task': return store.createPersonal(args);
    case 'decide_attention_item': return store.decide(args);
    case 'get_slack_reply': return getReply(store,args);
    case 'prepare_slack_reply': return prepareReply(store,args);
    case 'save_slack_reply': return {...store.view(),reply:store.replies.save(args)};
    case 'send_slack_reply': return sendReply(store,args);
    default: throw new StoreError('unknown_tool', 'Unknown Sauron tool.');
  }
}
