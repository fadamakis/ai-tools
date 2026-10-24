import React, { createContext, useContext } from 'react';
export const OpenLinkContext=createContext(null);
export function ExternalLink({href,children,...props}){
  const open=useContext(OpenLinkContext);
  return <a href={href} target="_blank" rel="noreferrer" {...props} onClick={event=>{if(open){event.preventDefault();void open(href);}}}>{children}</a>;
}
