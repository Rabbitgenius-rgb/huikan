import React from 'react';
import {createRoot} from 'react-dom/client';
import RecallApp from './RecallApp.jsx';
import './base.css';

class ErrorBoundary extends React.Component{
 state={error:null};
 static getDerivedStateFromError(error){return {error};}
 render(){return this.state.error?<main className="recall-loading" role="alert"><h1>回看未能打开</h1><p>原有资料仍保存在本机。请重新打开窗口。</p><button onClick={()=>location.reload()}>重新打开</button></main>:this.props.children;}
}
createRoot(document.getElementById('root')).render(<ErrorBoundary><RecallApp/></ErrorBoundary>);
