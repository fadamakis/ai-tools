import React from 'react';
export class AppBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main className="product-main" role="alert"><h1>Shelob could not be displayed</h1><p>Your saved reviews remain available. Reload Shelob to try again.</p><button type="button" onClick={()=>location.reload()}>Reload Shelob</button></main>:this.props.children;}
}
