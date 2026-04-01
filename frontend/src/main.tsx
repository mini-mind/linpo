import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout, RedirectToOverview } from './components/Layout';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { ProtectedRoute, PublicRoute } from './routes';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const LandingPage = lazy(() =>
  import('./components/LandingPage').then((module) => ({ default: module.LandingPage }))
);
const LoginPage = lazy(() =>
  import('./components/LoginPage').then((module) => ({ default: module.LoginPage }))
);
const PairingTutorialPage = lazy(() =>
  import('./components/PairingTutorialPage').then((module) => ({ default: module.PairingTutorialPage }))
);
const PairingReceiptConfirmPage = lazy(() =>
  import('./components/PairingReceiptConfirmPage').then((module) => ({
    default: module.PairingReceiptConfirmPage,
  }))
);
const SummaryPage = lazy(() =>
  import('./components/SummaryPage').then((module) => ({ default: module.SummaryPage }))
);
const CollabPage = lazy(() => import('./components/CollabPage'));
const FlowPage = lazy(() =>
  import('./components/FlowPage').then((module) => ({ default: module.FlowPage }))
);
const InstanceFilesPage = lazy(() =>
  import('./components/InstanceFilesPage').then((module) => ({ default: module.InstanceFilesPage }))
);
const PairingPage = lazy(() =>
  import('./components/PairingPage').then((module) => ({ default: module.PairingPage }))
);
const ProfilePage = lazy(() =>
  import('./components/ProfilePage').then((module) => ({ default: module.ProfilePage }))
);

function App(): JSX.Element {
  return (
    <AuthProvider>
      <ToastProvider>
        <style>{globalFormControlStyleText}</style>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
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
                  <Route path="summary" element={<SummaryPage />} />
                  <Route path="kanban" element={<CollabPage />} />
                  <Route path="flow" element={<Navigate to="/flow/edit/new" replace />} />
                  <Route path="flow/edit/:flowId" element={<FlowPage />} />
                  <Route path="instance-files" element={<InstanceFilesPage />} />
                  <Route path="pairing" element={<PairingPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="*" element={<Navigate to="/kanban" replace />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

const globalFormControlStyleText = `
  *, *::before, *::after {
    box-sizing: border-box;
  }

  input,
  textarea,
  select {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    font: inherit;
  }
`;

function RouteFallback(): JSX.Element {
  return (
    <div style={fallbackStyle} aria-label="页面加载中">
      正在加载页面...
    </div>
  );
}

const fallbackStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background:
    'radial-gradient(1000px 700px at 10% -10%, rgba(16, 185, 129, 0.23), transparent 65%), radial-gradient(900px 700px at 95% 0%, rgba(14, 165, 233, 0.2), transparent 62%), linear-gradient(180deg, #f0f8fa 0%, #eef6f2 52%, #f6f8ef 100%)',
  color: '#334155',
  fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", sans-serif',
  fontSize: '0.95rem',
  fontWeight: 600,
};

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
