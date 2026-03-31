import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import CollabPage from './components/CollabPage';
import { FlowListPage } from './components/FlowListPage';
import { FlowPage } from './components/FlowPage';
import { LandingPage } from './components/LandingPage';
import { Layout, RedirectToOverview } from './components/Layout';
import { LoginPage } from './components/LoginPage';
import { PairingPage } from './components/PairingPage';
import { PairingReceiptConfirmPage } from './components/PairingReceiptConfirmPage';
import { PairingTutorialPage } from './components/PairingTutorialPage';
import { ProfilePage } from './components/ProfilePage';
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
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/pairing/tutorial" element={<PairingTutorialPage />} />
            <Route element={<PublicRoute />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
            <Route element={<ProtectedRoute />}>
              <Route path="/pairing/receipt/:token" element={<PairingReceiptConfirmPage />} />
              <Route path="/" element={<Layout />}>
                <Route index element={<RedirectToOverview />} />
                <Route path="kanban" element={<CollabPage />} />
                <Route path="flow" element={<FlowListPage />} />
                <Route path="flow/edit/:flowId" element={<FlowPage />} />
                <Route path="pairing" element={<PairingPage />} />
                <Route path="profile" element={<ProfilePage />} />
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
