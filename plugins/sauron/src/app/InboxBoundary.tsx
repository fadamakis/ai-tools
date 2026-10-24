import React, { Component } from 'react';
export class InboxBoundary extends Component<{children:React.ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div role="alert" className="view-recovery">Sauron could not be displayed. Your saved tasks are still available.<button type="button" onClick={()=>window.location.reload()}>Reload Sauron</button></div>:this.props.children;}
}
