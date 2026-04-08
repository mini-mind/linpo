import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';

const DEFAULT_POST_LOGIN_PATH = '/summary';

function shouldForceSummary(pathname: string): boolean {
  return pathname.startsWith('/flow') || pathname.startsWith('/kanban');
}

export function resolvePostLoginPath(pathname: string | null | undefined): string {
  const trimmed = (pathname ?? '').trim();
  if (trimmed === '' || trimmed === '/login') {
    return DEFAULT_POST_LOGIN_PATH;
  }
  if (shouldForceSummary(trimmed)) {
    return DEFAULT_POST_LOGIN_PATH;
  }
  return trimmed;
}

export function ProtectedRoute(): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#4b5563' }}>
        加载中...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

export function PublicRoute(): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: '#4b5563' }}>
        加载中...
      </div>
    );
  }

  if (user) {
    const from = resolvePostLoginPath((location.state as { from?: { pathname?: string } })?.from?.pathname);
    return <Navigate to={from} replace />;
  }

  return <Outlet />;
}
