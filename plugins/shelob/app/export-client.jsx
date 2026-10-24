import React, { useEffect, useRef, useState } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { AppsSDKUIProvider } from '@openai/apps-sdk-ui/components/AppsSDKUIProvider';
import { ReportView } from './Report.jsx';
import { Icon, Quiet } from './ui.jsx';
function Theme(){
  const [dark,setDark]=useState(document.documentElement.dataset.theme==='dark');
  const choice=useRef(null);
  useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');let saved;try{saved=localStorage.getItem('shelob.report.theme');}catch{}choice.current=['light','dark'].includes(saved)?saved:null;const apply=()=>{const next=choice.current?choice.current==='dark':media.matches;document.documentElement.dataset.theme=next?'dark':'light';setDark(next);};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[]);
  function toggle(){const next=dark?'light':'dark';choice.current=next;document.documentElement.dataset.theme=next;setDark(!dark);try{localStorage.setItem('shelob.report.theme',next);}catch{}}
  return <Quiet uniform id="theme" aria-label={`Switch to ${dark?'light':'dark'} theme`} onClick={toggle}><Icon name={dark?'sun':'moon'}/></Quiet>;
}
const report=JSON.parse(document.getElementById('report-data').textContent);
hydrateRoot(document.getElementById('report-root'),<AppsSDKUIProvider linkComponent="a"><ReportView report={report} staticContent/></AppsSDKUIProvider>);
createRoot(document.getElementById('export-theme')).render(<AppsSDKUIProvider linkComponent="a"><Theme/></AppsSDKUIProvider>);
