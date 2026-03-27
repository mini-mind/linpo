import type React from 'react';
import { Link, Navigate, NavLink, Outlet } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';
import { AccountMenu } from './AccountMenu';

function ToastContainer(): JSX.Element {
  const { toasts, removeToast } = useToast();

  return (
    <div style={toastContainerStyle}>
      {toasts.map((toast) => (
        <div key={toast.id} style={getToastStyle(toast.type)}>
          <span style={toastMessageStyle}>{toast.message}</span>
          <button
            type="button"
            style={toastCloseButtonStyle}
            onClick={() => removeToast(toast.id)}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Layout(): JSX.Element {
  const isMobile = useIsMobile(960);

  return (
    <div style={shellStyle}>
      <style>{`${toastAnimationStyle}\n${navLinkHoverStyle}`}</style>
      <ToastContainer />
      <header style={toolbarStyle}>
        <div style={toolbarLeftStyle}>
          <Link to="/landing" style={isMobile ? brandBlockMobileStyle : brandBlockStyle} aria-label="灵盘">
            <img src="/assets/brand/linpo-flame-icon.svg" alt="" aria-hidden="true" style={brandIconStyle} />
            <div>
              <div style={brandTitleRowStyle}>
                <p style={brandTitleStyle}>灵盘</p>
                {!isMobile ? <span style={brandSloganStyle}>——让协作更顺，让结果更稳</span> : null}
              </div>
            </div>
          </Link>

          <nav style={toolbarNavStyle} aria-label="主导航">
            <NavLink to="/kanban" className="linpo-nav-link" style={({ isActive }) => getNavTextLinkStyle(isActive)}>
              看板
            </NavLink>
          </nav>
        </div>

        <div style={toolbarRightStyle}>
          <AccountMenu compact menuPlacement="below" triggerVariant="icon" />
        </div>
      </header>

      <main style={mainStyle} data-testid="layout-main-shell">
        <Outlet />
      </main>
    </div>
  );
}

export function RedirectToKanban(): JSX.Element {
  return <Navigate to="/kanban" replace />;
}

// Kept for backward compatibility in existing test imports.
export function RedirectToOverview(): JSX.Element {
  return <RedirectToKanban />;
}

const shellStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background:
    'radial-gradient(1000px 700px at 10% -10%, rgba(16, 185, 129, 0.23), transparent 65%), radial-gradient(900px 700px at 95% 0%, rgba(14, 165, 233, 0.2), transparent 62%), linear-gradient(180deg, #f0f8fa 0%, #eef6f2 52%, #f6f8ef 100%)',
  color: '#10212f',
  fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", sans-serif',
};

const toolbarStyle: React.CSSProperties = {
  height: '56px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '0 0.85rem',
  borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
  backdropFilter: 'blur(10px)',
  background: 'rgba(255, 255, 255, 0.36)',
};

const toolbarLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1.2rem',
  flex: 1,
  minWidth: 0,
};

const brandBlockStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  minWidth: '220px',
  textDecoration: 'none',
  color: 'inherit',
};

const brandBlockMobileStyle: React.CSSProperties = {
  ...brandBlockStyle,
  minWidth: 'auto',
  gap: '0.4rem',
};

const brandIconStyle: React.CSSProperties = {
  width: '2.5rem',
  height: '2.5rem',
  display: 'block',
  flexShrink: 0,
};

const brandTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.35rem',
  whiteSpace: 'nowrap',
};

const brandTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  lineHeight: 1.2,
};

const brandSloganStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#52616f',
  letterSpacing: '0.02em',
  fontWeight: 500,
  lineHeight: 1.2,
};

const toolbarNavStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: '0.65rem',
  justifyContent: 'flex-start',
  alignSelf: 'stretch',
  borderLeft: '1px solid rgba(148, 163, 184, 0.35)',
  borderRight: '1px solid rgba(148, 163, 184, 0.35)',
  padding: '0 0.55rem',
};

function getNavTextLinkStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    textDecoration: 'none',
    color: isActive ? '#0f766e' : '#334155',
    fontSize: '0.88rem',
    fontWeight: isActive ? 700 : 600,
    lineHeight: 1,
    height: '100%',
    padding: '0 0.55rem',
    borderRadius: 0,
    transition: 'background 0.18s ease',
  };
}

const toolbarRightStyle: React.CSSProperties = {
  minWidth: '64px',
  display: 'flex',
  justifyContent: 'flex-end',
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  padding: '0.8rem',
  background: 'transparent',
  overflowX: 'hidden',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
};

const toastContainerStyle: React.CSSProperties = {
  position: 'fixed',
  top: '0.875rem',
  right: '0.875rem',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  width: 'min(400px, calc(100vw - 1.5rem))',
};

function getToastStyle(type: 'error' | 'success' | 'warning' | 'info'): React.CSSProperties {
  const colors = {
    error: { bg: '#fee2e2', border: '#fecaca', text: '#991b1b' },
    success: { bg: '#d1fae5', border: '#a7f3d0', text: '#065f46' },
    warning: { bg: '#fef3c7', border: '#fde68a', text: '#92400e' },
    info: { bg: '#dbeafe', border: '#bfdbfe', text: '#1e40af' },
  };
  const c = colors[type];
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1rem',
    background: c.bg,
    border: `1px solid ${c.border}`,
    borderRadius: '0.5rem',
    color: c.text,
    fontSize: '0.875rem',
    fontWeight: 500,
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    animation: 'slideIn 0.2s ease-out',
  };
}

const toastMessageStyle: React.CSSProperties = {
  flex: 1,
};

const toastCloseButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontSize: '1.25rem',
  cursor: 'pointer',
  padding: 0,
  margin: 0,
  color: 'inherit',
  opacity: 0.6,
  transition: 'opacity 0.2s',
};

const toastAnimationStyle = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;

const navLinkHoverStyle = `
  .linpo-nav-link:hover {
    background: rgba(15, 118, 110, 0.12);
  }
`;
