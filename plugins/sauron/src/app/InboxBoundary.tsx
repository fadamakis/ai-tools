import {diagnostics,correlation} from './diagnostics.js';
import React, { Component } from 'react';
export class InboxBoundary extends Component<{children:React.ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidMount(){if(!this.state.failed)diagnostics.record('display','saved',correlation('display'),'unknown','saved');}
  componentDidCatch(){diagnostics.record('display','failed',correlation('display'));}
  render(){return this.state.failed?<div role="alert" className="view-recovery">Sauron could not be displayed. Reload the panel to try displaying your saved tasks again.<button type="button" onClick={()=>window.location.reload()}>Reload Sauron</button></div>:this.props.children;}
}
