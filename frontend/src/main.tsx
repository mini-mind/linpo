import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import CollabPage from './components/CollabPage';
import { FlowPage } from './components/FlowPage';
import { LandingPage } from './components/LandingPage';
import { Layout, RedirectToOverview } from './components/Layout';
import { LoginPage } from './components/LoginPage';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { ProtectedRoute, PublicRoute } from './routes';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

function App(): JSX.Element {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicRoute />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Layout />}>
                <Route index element={<RedirectToOverview />} />
                <Route path="landing" element={<LandingPage />} />
                <Route path="kanban" element={<CollabPage />} />
                <Route path="flow" element={<FlowPage />} />
                <Route path="*" element={<Navigate to="/kanban" replace />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
