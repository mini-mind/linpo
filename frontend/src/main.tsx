import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AgentWorkspace } from './components/AgentWorkspace';
import { InstanceTopology } from './components/InstanceTopology';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InstanceTopology />} />
        <Route path="/agents/:agentId" element={<AgentWorkspace />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);