import type React from 'react';
import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import { ToastProvider, useToast } from '../hooks/useToast';
import { AccountMenu } from './AccountMenu';

type NavItem = {
  to: string;
  label: string;
  icon: string;
  mobileIconOnly?: boolean;
};

const DESKTOP_PRIMARY_NAV_ITEMS: NavItem[] = [
  { to: '/topology', label: '拓扑', icon: '◇' },
  { to: '/kanban', label: '看板', icon: '▤' },
  { to: '/team', label: '团队', icon: '◎' },
];

const MOBILE_PRIMARY_NAV_ITEMS: NavItem[] = [
  { to: '/overview', label: '总览', icon: '灵', mobileIconOnly: true },
  ...DESKTOP_PRIMARY_NAV_ITEMS,
];

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
  const isMobile = useIsMobile();

  return (
    <ToastProvider>
      <div style={layoutStyle}>
        <style>{toastAnimationStyle}</style>
        <ToastContainer />
        {isMobile ? (
          // 移动端：icon 合并进 IA，不占用顶部内容区
          <>
            <main style={mobileMainStyle} data-testid="layout-main-shell">
              <Outlet />
            </main>
            <nav style={mobileNavStyle} aria-label="主导航">
              {MOBILE_PRIMARY_NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  style={({ isActive }) => getMobileNavItemStyle(isActive, item.mobileIconOnly)}
                >
                  <span style={mobileIconStyle}>{item.icon}</span>
                  {item.mobileIconOnly ? null : <span>{item.label}</span>}
                </NavLink>
              ))}
              <div style={mobileAccountNavItemStyle}>
                <AccountMenu compact menuPlacement="above" triggerVariant="icon" />
                <span style={mobileAccountLabelStyle}>账户</span>
              </div>
            </nav>
          </>
        ) : (
          // PC端：左侧侧边栏
          <>
            <aside style={sidebarStyle}>
              <div style={sidebarHeaderStyle}>
                <NavLink to="/overview" aria-label="进入总览" style={desktopLogoLinkStyle}>
                  <span style={logoStyle}>灵</span>
                </NavLink>
              </div>
              <nav style={sidebarNavStyle}>
                {DESKTOP_PRIMARY_NAV_ITEMS.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    style={({ isActive }) => getSidebarItemStyle(isActive)}
                    title={item.label}
                  >
                    <span style={sidebarIconStyle}>{item.icon}</span>
                    <span style={sidebarLabelStyle}>{item.label}</span>
                  </NavLink>
                ))}
              </nav>
              <AccountMenu />
            </aside>
            <main style={mainStyle} data-testid="layout-main-shell">
              <Outlet />
            </main>
          </>
        )}
      </div>
    </ToastProvider>
  );
}

const layoutStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  background: '#f4f1ea',
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  color: '#1f2933',
  overflow: 'hidden',
};

// PC端侧边栏样式
const sidebarStyle: React.CSSProperties = {
  width: '72px',
  background: '#fff',
  borderRight: '1px solid #e5e7eb',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
};

const sidebarHeaderStyle: React.CSSProperties = {
  height: '56px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderBottom: '1px solid #e5e7eb',
};

const desktopLogoLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
};

const logoStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 700,
  color: '#3b82f6',
};

const sidebarNavStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: '0.5rem 0',
  gap: '0.25rem',
};

function getSidebarItemStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.75rem 0.5rem',
    margin: '0 0.5rem',
    borderRadius: '0.5rem',
    color: isActive ? '#3b82f6' : '#6b7280',
    background: isActive ? '#eff6ff' : 'transparent',
    textDecoration: 'none',
    transition: 'all 0.2s',
    cursor: 'pointer',
  };
}

const sidebarIconStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  marginBottom: '0.25rem',
};

const sidebarLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 500,
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
};

// 移动端样式
const mobileMainStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
  paddingBottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
};

const mobileNavStyle: React.CSSProperties = {
  position: 'fixed',
  left: '0.625rem',
  right: '0.625rem',
  bottom: 'calc(0.375rem + env(safe-area-inset-bottom, 0px))',
  height: '62px',
  borderRadius: '16px',
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid #e5e7eb',
  backdropFilter: 'blur(10px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-around',
  zIndex: 100,
  boxShadow: '0 12px 30px -18px rgba(17, 24, 39, 0.5)',
};

function getMobileNavItemStyle(isActive: boolean, iconOnly = false): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: iconOnly ? '50px' : '62px',
    height: '50px',
    borderRadius: '12px',
    padding: iconOnly ? '0.25rem' : '0.25rem 0.6rem',
    color: isActive ? '#1d4ed8' : '#6b7280',
    background: isActive ? '#e0ecff' : 'transparent',
    textDecoration: 'none',
    fontSize: '0.75rem',
    fontWeight: isActive ? 600 : 400,
  };
}

const mobileIconStyle: React.CSSProperties = {
  fontSize: '1.1rem',
  marginBottom: '0.125rem',
};

const mobileAccountNavItemStyle: React.CSSProperties = {
  minWidth: '62px',
  height: '50px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.15rem',
};

const mobileAccountLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#6b7280',
  lineHeight: 1,
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
  padding: '0',
  margin: '0',
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

export function RedirectToOverview(): JSX.Element {
  return <Navigate to="/overview" replace />;
}
