import {createHash} from 'node:crypto';
/** Exact connector IDs and read operations verified with app/list + app/read.
 * Unknown apps/tools are disabled. No global Codex settings are changed. */
export const localReaders = {
  slack:{id:'asdk_app_69a1d78e929881919bba0dbda1f6436d',tools:['slack_read_user_profile','slack_search_public','slack_search_public_and_private','slack_search_channels','slack_search_users','slack_read_channel','slack_read_thread']},
  jira:{id:'asdk_app_6a83901dde988191b3f3cefdcc19acfa',tools:['atlassianUserInfo','getAccessibleAtlassianResources','searchJiraIssuesUsingJql','getJiraIssue','discover','executeRead']},
  github:{id:'connector_76869538009648d5b282a4bb21c3d157',tools:['get_user_login','get_profile','search_prs','search_issues','fetch_pr','get_pr_info','fetch_pr_comments','fetch_issue','fetch_issue_comments']},
  calendar:{id:'connector_947e0d954944416db111db556030eea6',tools:['get_profile','search_events','search','read_event','batch_read_event']},
  granola:{id:'asdk_app_697761cab6f48191b5ed345919a3ce8b',tools:['list_meetings','get_meetings','get_meeting_transcript']},
} as const;
export function localPolicyArgs() {
  const values:Record<string,unknown>={
    'features.plugins':true,'features.apps':true,'features.hooks':false,'features.memories':false,
    'features.in_app_browser':false,'features.in_app_chat':false,'features.in_app_local_automation':false,'features.shell_tool':false,'features.multi_agent':false,'web_search':'disabled',
    'project_doc_max_bytes':0,'mcp_servers':{},'apps._default.enabled':false,
  };
  // Keep the app/plugin gateway available, but deny every installed local MCP
  // server. A transport is supplied because config validation precedes plugin merge.
  for(const server of ['code-review','codex_app','computer-use','cua_repl','event-stream','node_repl','sauron','shelob','workbench']){
    values[`mcp_servers.${server}.command`]='/usr/bin/false';
    values[`mcp_servers.${server}.enabled`]=false;
  }
  values['mcp_servers.atlassian-mcp-server.url']='https://mcp.atlassian.com/v1/sse';
  values['mcp_servers.atlassian-mcp-server.enabled']=false;
  for(const reader of Object.values(localReaders)){
    values[`apps.${reader.id}.enabled`]=true;
    values[`apps.${reader.id}.default_tools_enabled`]=false;
    values[`apps.${reader.id}.destructive_enabled`]=false;
    for(const tool of reader.tools)values[`apps.${reader.id}.tools.${tool}.enabled`]=true;
  }
  return Object.entries(values).flatMap(([key,value])=>['-c',`${key}=${JSON.stringify(value)}`]);
}
export function minimalAgentEnv(env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  // No desktop IPC/session variables, provider tokens, hooks, or ATTENTION_DB.
  const keys=['HOME','USER','LOGNAME','PATH','TMPDIR','LANG','LC_ALL','CODEX_HOME','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'];
  return Object.fromEntries(keys.filter(key=>env[key]!==undefined).map(key=>[key,env[key]]));
}

export const localPolicyDigest=createHash('sha256').update(JSON.stringify(localPolicyArgs())).digest('hex');
