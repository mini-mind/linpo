import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout, RedirectToSummary } from './components/Layout';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

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

function App(): JSX.Element {
  return (
    <AuthProvider>
      <ToastProvider>
        <style>{globalFormControlStyleText}</style>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<RedirectToSummary />} />
              <Route
                path="summary"
                element={(
                  <Suspense fallback={<RouteFallback pageName="摘要" />}>
                    <SummaryPage />
                  </Suspense>
                )}
              />
              <Route
                path="kanban"
                element={(
                  <Suspense fallback={<RouteFallback pageName="看板" />}>
                    <CollabPage />
                  </Suspense>
                )}
              />
              <Route path="flow" element={<Navigate to="/flow/edit/new" replace />} />
              <Route
                path="flow/edit/:flowId"
                element={(
                  <Suspense fallback={<RouteFallback pageName="流程" />}>
                    <FlowPage />
                  </Suspense>
                )}
              />
              <Route
                path="files"
                element={(
                  <Suspense fallback={<RouteFallback pageName="文件" />}>
                    <InstanceFilesPage />
                  </Suspense>
                )}
              />
              <Route path="instance-files" element={<Navigate to="/files" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/summary" replace />} />
          </Routes>
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

function RouteFallback({ pageName }: { pageName: string }): JSX.Element {
  return (
    <section style={fallbackStyle} aria-label={`${pageName}加载中`} data-testid="route-loading-placeholder">
      <div style={fallbackCardStyle}>
        <p style={fallbackTitleStyle}>正在进入{pageName}</p>
        <p style={fallbackHintStyle}>页面内容加载中，请稍候...</p>
      </div>
    </section>
  );
}

const fallbackCardStyle: React.CSSProperties = {
  borderRadius: '0.75rem',
  border: '1px solid rgba(15, 23, 42, 0.08)',
  background: 'rgba(255, 255, 255, 0.72)',
  backdropFilter: 'blur(6px)',
  padding: '0.9rem 1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  minWidth: '220px',
};

const fallbackTitleStyle: React.CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: '0.92rem',
  fontWeight: 700,
};

const fallbackHintStyle: React.CSSProperties = {
  margin: 0,
  color: '#475569',
  fontSize: '0.78rem',
  fontWeight: 500,
};

const fallbackStyle: React.CSSProperties = {
  minHeight: 'calc(100dvh - 56px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  background:
    'radial-gradient(1000px 700px at 10% -10%, rgba(16, 185, 129, 0.23), transparent 65%), radial-gradient(900px 700px at 95% 0%, rgba(14, 165, 233, 0.2), transparent 62%), linear-gradient(180deg, #f0f8fa 0%, #eef6f2 52%, #f6f8ef 100%)',
  color: '#334155',
  fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", sans-serif',
};

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
