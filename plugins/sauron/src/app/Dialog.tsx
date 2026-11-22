import {useEffect,useId,useRef,type ReactNode} from 'react';
import {Button} from '@ai-tools/ui';
import {Icon} from './icons.js';

export function Dialog({title,close,children,closeDisabled=false}:{title:string;close:()=>void;children:ReactNode;closeDisabled?:boolean}){
  const ref=useRef<HTMLDialogElement>(null);const id=useId();
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className="inbox-dialog" aria-labelledby={id} onCancel={event=>{if(closeDisabled)event.preventDefault();else close();}}>
    <header><h2 id={id}>{title}</h2><Button variant="ghost" color="secondary" uniform disabled={closeDisabled} aria-label={`Close ${title.toLowerCase()}`} onClick={close}><Icon name="close"/></Button></header>{children}
  </dialog>;
}
