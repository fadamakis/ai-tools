import React from 'react';
import { createRoot } from 'react-dom/client';
import { useSauronController } from './controller.js';
import { InboxBoundary } from './InboxBoundary.js';
import { InboxView } from './InboxView.js';

function Sauron(){
  const vm=useSauronController();
  return <InboxBoundary><InboxView vm={vm}/></InboxBoundary>;
}
createRoot(document.getElementById('root')!).render(<Sauron/>);
