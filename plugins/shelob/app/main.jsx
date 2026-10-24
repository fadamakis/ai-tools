import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { AppsSDKUIProvider } from '@openai/apps-sdk-ui/components/AppsSDKUIProvider';
import { ShelobController } from './controller.mjs';
import { AppView } from './App.jsx';
import { AppBoundary } from './Boundary.jsx';
import { OpenLinkContext } from './links.jsx';

const app=new App({name:'Shelob',version:__SHELOB_VERSION__});
const vm=new ShelobController(app,new OpenAIExtensions(app),{applyDocumentTheme,applyHostStyleVariables},{appVersion:__SHELOB_VERSION__});
createRoot(document.getElementById('app')).render(<AppBoundary><AppsSDKUIProvider linkComponent="a"><OpenLinkContext.Provider value={vm.openLink}><AppView vm={vm}/></OpenLinkContext.Provider></AppsSDKUIProvider></AppBoundary>);
vm.connect().catch(error=>{vm.error=error.message||'Try connecting again, or ask Shelob to review your changes in a conversation.';vm.publish();});
