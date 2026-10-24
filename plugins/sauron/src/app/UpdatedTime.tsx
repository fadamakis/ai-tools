import React, { useEffect, useState } from 'react';
import { date } from './presentation.js';

const relative=new Intl.RelativeTimeFormat(undefined,{numeric:'always'});

export function UpdatedTime({value}:{value:string}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer);},[]);
  const elapsed=Math.max(0,now-Date.parse(value));
  const text=elapsed<60_000?'just now':elapsed<3_600_000?relative.format(-Math.floor(elapsed/60_000),'minute')
    :elapsed<86_400_000?relative.format(-Math.floor(elapsed/3_600_000),'hour'):relative.format(-Math.floor(elapsed/86_400_000),'day');
  return <time dateTime={value} title={date(value)}>{text}</time>;
}
