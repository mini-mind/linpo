import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AgentDetail } from './components/AgentDetail';
import { AgentsList } from './components/AgentsList';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

/**
 * Linpo v0.1 Observer - Minimal Frontend
 * 
 * Routes:
 * - / : Agents list page (home)
 * - /agents/:agentId : Agent detail page with topology (placeholder)
 * 
 * Per detailed design section 6: 前端页面骨架
 */
function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AgentsList />} />
        <Route path="/agents/:agentId" element={<AgentDetail />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
