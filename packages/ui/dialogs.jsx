import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Quiet } from './index.jsx';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from '@openai/apps-sdk-ui/components/Icon';
// SDK popup menus portal to body. A portal dialog keeps those controls outside
// the inert app while preserving a focus trap and the original opener.
export function ReaderDialog({ title, close, busy=false, children, className='' }) {
  const ref=useRef(null), titleId=useId();
  useEffect(()=>{
    const opener=document.activeElement, app=document.getElementById('app');
    const previous=app?.inert; if(app)app.inert=true;
    const first=ref.current?.querySelector('[autofocus]')||ref.current?.querySelector('input:not([type=hidden]),textarea')||ref.current?.querySelector('button:not([disabled])');
    (first||ref.current)?.focus();
    return ()=>{ if(app)app.inert=previous; if(opener?.isConnected)opener.focus(); };
  },[]);
  function key(event) {
    if(event.key==='Escape'&&!event.defaultPrevented&&!busy){ event.preventDefault(); close(); }
    if(event.key!=='Tab'||event.defaultPrevented)return;
    const items=[...ref.current.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),textarea:not([disabled]),[tabindex="0"]')].filter(el=>el.tabIndex>=0&&!el.closest('[hidden]')&&el.getAttribute('aria-disabled')!=='true');
    const first=items[0],last=items.at(-1);
    if(!items.length){event.preventDefault();ref.current.focus();}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  return createPortal(<div className="product-modal-backdrop"><section className={`product-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} onKeyDown={key}>
    <header><h2 id={titleId}>{title}</h2><Quiet uniform disabled={busy} aria-label={`Close ${title.toLowerCase()}`} onClick={close}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></Quiet></header>{children}
  </section></div>,document.body);
}

export function BoardDialog({ title, close, busy, wide = false, returnFocus, children }) {
  const opener = useRef(returnFocus || document.activeElement);
  const content = useRef(null);
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="modal-backdrop"/>
      <DialogPrimitive.Content ref={content} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-describedby={undefined}
        onOpenAutoFocus={event => { if (busy) { event.preventDefault(); content.current?.focus({ preventScroll: true }); } }}
        onPointerDownOutside={event => { if (busy) event.preventDefault(); }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}>
        <header className="dialog-heading"><DialogPrimitive.Title>{title}</DialogPrimitive.Title><Quiet uniform aria-label={`Close ${title.toLowerCase()}`} disabled={busy} onClick={close}><X width="18" height="18" aria-hidden="true"/></Quiet></header>
        <div className="dialog-body">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
