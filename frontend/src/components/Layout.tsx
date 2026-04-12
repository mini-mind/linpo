import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const isFlowRoute = location.pathname.startsWith('/flow');
  const isKanbanRoute = location.pathname.startsWith('/kanban');
  // 文件页存在新旧两套路由入口（/instance-files 会重定向到 /files），
  // 这里统一按“文件工作区”判定，确保主容器走贴边布局。
  const isInstanceFilesRoute = location.pathname.startsWith('/instance-files') || location.pathname.startsWith('/files');
  const mainRef = useRef<HTMLElement | null>(null);
  const [flowNavTarget, setFlowNavTarget] = useState('/flow/edit/new');

  useEffect(() => {
    const cached = loadLastFlowEntryPath();
    setFlowNavTarget(cached ?? '/flow/edit/new');
  }, []);

  useEffect(() => {
    const candidate = normalizeFlowEntryPath(`${location.pathname}${location.search}${location.hash}`);
    if (!candidate) {
      return;
    }
    saveLastFlowEntryPath(candidate);
    setFlowNavTarget(candidate);
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    const mainElement = mainRef.current;
    if (!mainElement) {
      return;
    }
    if (typeof mainElement.scrollTo === 'function') {
      mainElement.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }
    mainElement.scrollTop = 0;
    mainElement.scrollLeft = 0;
  }, [location.pathname, location.search]);

  return (
    <div style={shellStyle}>
      <style>{`${toastAnimationStyle}\n${navLinkHoverStyle}\n${globalFormControlStyle}`}</style>
      <ToastContainer />
      <header style={getToolbarStyle(isMobile)}>
        <div style={getToolbarLeftStyle(isMobile)}>
          <Link to="/kanban" style={isMobile ? brandBlockMobileStyle : brandBlockStyle} aria-label="灵盘">
            <img src="/assets/brand/linpo-flame-icon.svg" alt="" aria-hidden="true" style={brandIconStyle} />
            <div>
              <div style={brandTitleRowStyle}>
                <p style={brandTitleStyle}>灵盘</p>
                {!isMobile ? <span style={brandSloganStyle}>——灵活调度任务的Agent沙盘</span> : null}
              </div>
            </div>
          </Link>

          <nav style={getToolbarNavStyle(isMobile)} aria-label="主导航" data-testid="layout-main-nav">
            <span aria-hidden="true" style={toolbarNavDividerStyle} data-testid="toolbar-nav-divider" />
            <NavLink
              to="/kanban"
              className="linpo-nav-link"
              style={({ isActive }) => getNavTextLinkStyle(isActive)}
            >
              看板
            </NavLink>
            <span aria-hidden="true" style={toolbarNavDividerStyle} data-testid="toolbar-nav-divider" />
            <NavLink
              to={flowNavTarget}
              className="linpo-nav-link"
              style={() => getNavTextLinkStyle(isFlowRoute)}
            >
              流程
            </NavLink>
            <span aria-hidden="true" style={toolbarNavDividerStyle} data-testid="toolbar-nav-divider" />
            <NavLink
              to="/instance-files"
              className="linpo-nav-link"
              style={({ isActive }) => getNavTextLinkStyle(isActive || isInstanceFilesRoute)}
            >
              文件
            </NavLink>
            <span aria-hidden="true" style={toolbarNavDividerStyle} data-testid="toolbar-nav-divider" />
          </nav>
        </div>

        <div style={toolbarRightStyle}>
          <AccountMenu
            compact
            menuPlacement="below"
            triggerVariant="icon"
          />
        </div>
      </header>

      <main
        ref={mainRef}
        style={getMainStyle(isFlowRoute || isKanbanRoute || isInstanceFilesRoute)}
        data-testid="layout-main-shell"
      >
        <Outlet />
      </main>
    </div>
  );
}

const FLOW_ENTRY_STORAGE_KEY = 'linpo.lastFlowEntryPath';

function normalizeFlowEntryPath(rawPath: string | null | undefined): string | null {
  const value = String(rawPath ?? '').trim();
  if (!value.startsWith('/flow')) {
    return null;
  }
  if (value === '/flow' || value.startsWith('/flow?') || value.startsWith('/flow#')) {
    return '/flow/edit/new';
  }
  if (/^\/flow\/edit\/[^/?#]+(?:[?#].*)?$/.test(value)) {
    return value;
  }
  return '/flow/edit/new';
}

function loadLastFlowEntryPath(): string | null {
  try {
    return normalizeFlowEntryPath(window.localStorage.getItem(FLOW_ENTRY_STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveLastFlowEntryPath(path: string): void {
  try {
    window.localStorage.setItem(FLOW_ENTRY_STORAGE_KEY, path);
  } catch {
    // ignore storage failures
  }
}

const shellStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background:
    'radial-gradient(1000px 700px at 10% -10%, rgba(16, 185, 129, 0.23), transparent 65%), radial-gradient(900px 700px at 95% 0%, rgba(14, 165, 233, 0.2), transparent 62%), linear-gradient(180deg, #f0f8fa 0%, #eef6f2 52%, #f6f8ef 100%)',
  color: '#10212f',
  fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", sans-serif',
};

function getToolbarStyle(isMobile: boolean): React.CSSProperties {
  return {
    height: '56px',
    position: 'relative',
    zIndex: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: isMobile ? '0.55rem' : '1rem',
    padding: isMobile ? '0 0.6rem' : '0 0.85rem',
    borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
    backdropFilter: 'blur(10px)',
    background: 'rgba(255, 255, 255, 0.36)',
    overflow: 'visible',
  };
}

function getToolbarLeftStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: isMobile ? '0.5rem' : '1.2rem',
    flex: 1,
    minWidth: 0,
  };
}

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
  flexShrink: 0,
};

const brandIconStyle: React.CSSProperties = {
  width: '3rem',
  height: '3rem',
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

function getToolbarNavStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'stretch',
    gap: '0.18rem',
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
    flex: 1,
    minWidth: 0,
    overflowX: isMobile ? 'auto' : 'visible',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: isMobile ? 'none' : 'auto',
    msOverflowStyle: isMobile ? 'none' : undefined,
    touchAction: isMobile ? 'pan-x' : 'auto',
    whiteSpace: 'nowrap',
    padding: isMobile ? '0 0.3rem' : '0 0.55rem',
  };
}

const toolbarNavDividerStyle: React.CSSProperties = {
  width: '1px',
  alignSelf: 'center',
  height: '58%',
  background: 'rgba(148, 163, 184, 0.38)',
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

function getMainStyle(isEdgeToEdgeRoute: boolean): React.CSSProperties {
  return {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  padding: isEdgeToEdgeRoute ? 0 : '0.8rem',
  background: 'transparent',
  overflowX: 'hidden',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  };
}

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

const globalFormControlStyle = `
  :where(input, textarea, select) {
    box-sizing: border-box !important;
    min-width: 0 !important;
    max-width: 100% !important;
  }
`;
