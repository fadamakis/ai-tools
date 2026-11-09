export function prepareLocalPlugin(options?: {
  projectRoot?: string;
  outputDir?: string;
  databasePath?: string;
  pluginName?: string;
  displayName?: string;
  serverName?: string;
  runtimePath?: string;
  environment?: Record<string,string>;
}): Promise<string>;
