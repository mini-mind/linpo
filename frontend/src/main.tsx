import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout, RedirectToTopology } from './components/Layout';
import { TopologyPage } from './components/TopologyPage';
import SessionPage from './components/SessionPage';
import CollabPage from './components/CollabPage';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<RedirectToTopology />} />
          <Route path="topology" element={<TopologyPage />} />
          <Route path="session" element={<SessionPage />} />
          <Route path="session/:agentId" element={<SessionPage />} />
          <Route path="collab" element={<CollabPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);