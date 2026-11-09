declare const __SAURON_DEV_BUILD_ID__: string;
declare const __SAURON_PLUGIN_REFERENCE__: string;

export const devBuildId=typeof __SAURON_DEV_BUILD_ID__==='undefined'?'':__SAURON_DEV_BUILD_ID__;
export const pluginReference=typeof __SAURON_PLUGIN_REFERENCE__==='undefined'?'sauron@ai-tools':__SAURON_PLUGIN_REFERENCE__;
