import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';

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
    if (location.pathname === '/') {
      return <Navigate to="/landing" replace />;
    }
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
    const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/summary';
    return <Navigate to={from} replace />;
  }

  return <Outlet />;
}
