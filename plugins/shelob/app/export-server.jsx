import React from 'react';
import { renderToString } from 'react-dom/server';
import { ReportView } from './Report.jsx';
import { AppsSDKUIProvider } from '@openai/apps-sdk-ui/components/AppsSDKUIProvider';
export function renderReportView(report,options={}){
  return renderToString(<AppsSDKUIProvider linkComponent="a"><ReportView report={report} {...options} staticContent/></AppsSDKUIProvider>);
}
