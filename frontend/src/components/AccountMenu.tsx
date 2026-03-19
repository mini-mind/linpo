import type React from 'react';
import { useCallback, useState, useRef, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export function AccountMenu(): JSX.Element | null {
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const logoutButtonRef = useRef<HTMLButtonElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
      addToast('已退出登录', 'success');
    } catch {
      addToast('退出登录失败', 'error');
    }
  }, [logout, addToast]);

  const toggleMenu = useCallback(() => {
    setIsMenuOpen((prev) => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleMenu();
      }
    },
    [toggleMenu]
  );

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        triggerButtonRef.current?.focus();
      }
    },
    [closeMenu]
  );

  // Close menu when clicking outside
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen, closeMenu]);

  useEffect(() => {
    if (isMenuOpen) {
      logoutButtonRef.current?.focus();
    }
  }, [isMenuOpen]);

  // Don't render if not authenticated
  if (!user) {
    return null;
  }

  return (
    <div style={containerStyle} ref={menuRef}>
      <button
        type="button"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
        style={triggerButtonStyle}
        aria-label="打开账户菜单"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        ref={triggerButtonRef}
      >
        <span style={usernameStyle}>{user.username}</span>
      </button>

      {isMenuOpen && (
        <div style={menuStyle} role="menu" aria-label="账户菜单" onKeyDown={handleMenuKeyDown}>
          <div style={menuHeaderStyle}>
            <span style={menuUsernameStyle}>{user.username}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            style={menuLogoutButtonStyle}
            role="menuitem"
            ref={logoutButtonRef}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'relative',
  padding: '0.75rem 0.5rem',
  margin: '0 0.5rem 0.5rem 0.5rem',
  borderTop: '1px solid #e5e7eb',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const triggerButtonStyle: React.CSSProperties = {
  padding: '0.375rem 0.5rem',
  background: 'transparent',
  border: 'none',
  color: '#1f2933',
  fontSize: '0.75rem',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  width: '100%',
  textAlign: 'center',
  borderRadius: '0.375rem',
};

const usernameStyle: React.CSSProperties = {
  wordBreak: 'break-word',
  maxWidth: '100%',
};

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 0.5rem)',
  left: '0',
  right: '0',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '0.5rem',
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  padding: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  zIndex: 50,
};

const menuHeaderStyle: React.CSSProperties = {
  padding: '0.375rem 0.5rem',
  borderBottom: '1px solid #e5e7eb',
  marginBottom: '0.25rem',
};

const menuUsernameStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#1f2933',
  wordBreak: 'break-word',
  textAlign: 'center',
  display: 'block',
};

const menuLogoutButtonStyle: React.CSSProperties = {
  padding: '0.5rem',
  background: 'transparent',
  border: 'none',
  color: '#6b7280',
  fontSize: '0.75rem',
  fontWeight: 400,
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  textAlign: 'center',
  borderRadius: '0.375rem',
};
