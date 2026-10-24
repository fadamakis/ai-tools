import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { AppsSDKUIProvider } from '@openai/apps-sdk-ui/components/AppsSDKUIProvider';
import { BoardController } from './controller.mjs';
import { AppView } from './App.jsx';
import { EmptyMessage } from './ui.jsx';

class Boundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <main className="main-content"><section className="empty-results"><EmptyMessage><EmptyMessage.Title><h1>Could not open Workbench Preview.</h1></EmptyMessage.Title><EmptyMessage.Description>Your saved tasks are preserved. Reopen the preview, or report what you were doing.</EmptyMessage.Description></EmptyMessage></section></main> : this.props.children; }
}
const app = new App({ name: 'Workbench Preview', version: __WORKBENCH_VERSION__ });
const vm = new BoardController(app, new OpenAIExtensions(app), { applyDocumentTheme, applyHostStyleVariables });
createRoot(document.getElementById('app')).render(<Boundary><AppsSDKUIProvider linkComponent="a"><AppView vm={vm}/></AppsSDKUIProvider></Boundary>);
vm.connect().catch(error => { vm.error = 'Could not load your saved work. Try again.'; vm.errorDetails = error.message || String(error); vm.publish(); });
