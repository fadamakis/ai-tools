export { Secondary, Quiet } from '@ai-tools/ui';
import React, { useRef } from 'react';
import { Button } from '@ai-tools/ui';
export { Button };
export { Input } from '@ai-tools/ui';
export { Textarea } from '@ai-tools/ui';
export { Checkbox } from '@ai-tools/ui';
import { Select as SDKSelect } from '@ai-tools/ui';
export { SegmentedControl } from '@ai-tools/ui';
export { Menu } from '@ai-tools/ui';

export function Select(props){
  const ref=useRef(null);
  const focusTrigger=()=>requestAnimationFrame(()=>ref.current?.querySelector('[aria-haspopup="dialog"]')?.focus());
  return <div className="product-select" ref={ref} onKeyDownCapture={event=>{if(event.key==='Escape')focusTrigger();}}><SDKSelect {...props} onChange={option=>{props.onChange(option);focusTrigger();}}/></div>;
}
export function submitForm(event,submit){
  event.preventDefault();
  const form=event.currentTarget.tagName==='FORM'?event.currentTarget:event.currentTarget.closest('form');
  if(form?.reportValidity())void submit();
}
export function enterSubmits(event,submit){
  if(event.key==='Enter'&&!event.defaultPrevented&&!event.nativeEvent.isComposing&&event.target.tagName==='INPUT'&&event.target.form===event.currentTarget)submitForm(event,submit);
}
const iconPaths={refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17"/></>,plus:<path d="M12 5v14M5 12h14"/>,back:<path d="m14 6-6 6 6 6"/>,next:<path d="m10 6 6 6-6 6"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,check:<path d="m5 12 4 4L19 6"/>,moon:<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>,sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>};
export function Icon({ name, ...props }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{iconPaths[name]||iconPaths.sun}</svg>;
}

export { ReaderDialog as Dialog } from '@ai-tools/ui/dialogs';
