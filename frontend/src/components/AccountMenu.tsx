import type React from 'react';
import { useCallback, useState, useRef, useEffect } from 'react';
import { listUserMessages } from '../api/messageClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { InstanceListModal } from './InstanceListModal';
import { MessageCenterModal } from './MessageCenterModal';
import { PlannerAgentModal } from './PlannerAgentModal';
import { UserProfileModal } from './UserProfileModal';

type AccountMenuProps = {
  compact?: boolean;
  menuPlacement?: 'above' | 'below';
  triggerVariant?: 'username' | 'icon';
  openInstanceListSignal?: number;
};

export function AccountMenu({
  compact = false,
  menuPlacement = 'above',
  triggerVariant = 'username',
  openInstanceListSignal = 0,
}: AccountMenuProps = {}): JSX.Element | null {
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMessageCenterOpen, setIsMessageCenterOpen] = useState(false);
  const [isInstanceListOpen, setIsInstanceListOpen] = useState(false);
  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);
  const [isPlannerAgentModalOpen, setIsPlannerAgentModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const messageButtonRef = useRef<HTMLButtonElement>(null);
  const instanceButtonRef = useRef<HTMLButtonElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const handledAutoOpenSignalRef = useRef(0);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const messages = await listUserMessages();
      const count = messages.reduce((total, item) => {
        const isRead = item.is_read === true;
        return isRead ? total : total + 1;
      }, 0);
      setUnreadCount(count);
    } catch {
      // 静默失败，避免消息接口短暂不可用影响主操作
    }
  }, []);

  const handleLogout = useCallback(async () => {
    const confirmed = window.confirm('确认退出登录吗？');
    if (!confirmed) {
      return;
    }
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

  const handleOpenMessageCenter = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    window.setTimeout(() => {
      setIsMessageCenterOpen(true);
    }, 0);
  }, [closeMenu]);

  const handleOpenUserProfile = useCallback((event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    closeMenu();
    window.setTimeout(() => {
      setIsUserProfileOpen(true);
    }, 0);
  }, [closeMenu]);

  const handleOpenInstanceList = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    window.setTimeout(() => {
      setIsInstanceListOpen(true);
    }, 0);
  }, [closeMenu]);

  const handleOpenPlannerAgentModal = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    window.setTimeout(() => {
      setIsPlannerAgentModalOpen(true);
    }, 0);
  }, [closeMenu]);

  const handleCloseMessageCenter = useCallback(() => {
    setIsMessageCenterOpen(false);
    void refreshUnreadCount();
    triggerButtonRef.current?.focus();
  }, [refreshUnreadCount]);

  const handleCloseInstanceList = useCallback(() => {
    setIsInstanceListOpen(false);
    triggerButtonRef.current?.focus();
  }, []);

  const handleCloseUserProfile = useCallback(() => {
    setIsUserProfileOpen(false);
    triggerButtonRef.current?.focus();
  }, []);

  const handleClosePlannerAgentModal = useCallback(() => {
    setIsPlannerAgentModalOpen(false);
    triggerButtonRef.current?.focus();
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
      instanceButtonRef.current?.focus();
      void refreshUnreadCount();
    }
  }, [isMenuOpen, refreshUnreadCount]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void refreshUnreadCount();
  }, [refreshUnreadCount, user]);

  useEffect(() => {
    if (openInstanceListSignal <= 0) {
      return;
    }
    if (openInstanceListSignal === handledAutoOpenSignalRef.current) {
      return;
    }
    handledAutoOpenSignalRef.current = openInstanceListSignal;
    closeMenu();
    setIsInstanceListOpen(true);
  }, [closeMenu, openInstanceListSignal]);

  // Don't render if not authenticated
  if (!user) {
    return null;
  }

  return (
    <div style={getContainerStyle(compact)} ref={menuRef}>
      <button
        type="button"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
        style={getTriggerButtonStyle(compact)}
        aria-label="打开账户菜单"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        ref={triggerButtonRef}
      >
        {triggerVariant === 'icon' ? (
          <span aria-hidden={!user.avatar_url} style={triggerAvatarShellStyle}>
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="用户头像" style={triggerAvatarImageStyle} />
            ) : (
              <span aria-hidden="true" style={iconGlyphStyle}>{getAvatarText(user.username)}</span>
            )}
          </span>
        ) : (
          <span style={usernameStyle}>{user.username}</span>
        )}
        {unreadCount > 0 ? <span style={badgeStyle}>{formatUnreadCount(unreadCount)}</span> : null}
      </button>

      {isMenuOpen && (
        <div style={getMenuStyle(menuPlacement)} role="menu" aria-label="账户菜单" onKeyDown={handleMenuKeyDown}>
          <button
            type="button"
            style={menuHeaderButtonStyle}
            role="menuitem"
            onClick={handleOpenUserProfile}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <span style={menuUsernameStyle}>账户</span>
          </button>
          <button
            type="button"
            onClick={handleOpenInstanceList}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={menuActionButtonStyle}
            role="menuitem"
            ref={instanceButtonRef}
          >
            实例
          </button>
          <button
            type="button"
            onClick={handleOpenMessageCenter}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={menuActionButtonStyle}
            role="menuitem"
            ref={messageButtonRef}
          >
            消息{unreadCount > 0 ? ` (${formatUnreadCount(unreadCount)})` : ''}
          </button>
          <button
            type="button"
            onClick={handleOpenPlannerAgentModal}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={menuActionButtonStyle}
            role="menuitem"
          >
            Planner Agent
          </button>
          <button
            type="button"
            onClick={handleLogout}
            style={menuLogoutButtonStyle}
            role="menuitem"
          >
            退出登录
          </button>
        </div>
      )}
      <MessageCenterModal open={isMessageCenterOpen} onClose={handleCloseMessageCenter} />
      <InstanceListModal open={isInstanceListOpen} onClose={handleCloseInstanceList} />
      <UserProfileModal open={isUserProfileOpen} onClose={handleCloseUserProfile} user={user} />
      <PlannerAgentModal open={isPlannerAgentModalOpen} onClose={handleClosePlannerAgentModal} />
    </div>
  );
}

function formatUnreadCount(count: number): string {
  if (count > 99) {
    return '99+';
  }
  return String(count);
}

function getAvatarText(username: string | null | undefined): string {
  const normalized = username?.trim() ?? '';
  if (!normalized) {
    return 'U';
  }

  if (/^[\u3400-\u9fff]/.test(normalized)) {
    return normalized.charAt(0);
  }

  return normalized.slice(0, 2).toUpperCase();
}

function getContainerStyle(compact: boolean): React.CSSProperties {
  if (compact) {
    return {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
  }
  return {
    position: 'relative',
    padding: '0.75rem 0.5rem',
    margin: '0 0.5rem 0.5rem 0.5rem',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };
}

function getTriggerButtonStyle(compact: boolean): React.CSSProperties {
  if (compact) {
    return {
      width: '2.125rem',
      height: '2.125rem',
      borderRadius: '999px',
      position: 'relative',
      border: '1px solid #dbe4ef',
      background: 'rgba(255, 255, 255, 0.95)',
      color: '#0f172a',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      boxShadow: '0 10px 24px -20px rgba(15, 23, 42, 0.6)',
    };
  }
  return {
    padding: '0.375rem 0.5rem',
    background: 'transparent',
    border: 'none',
    position: 'relative',
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
}

const usernameStyle: React.CSSProperties = {
  wordBreak: 'break-word',
  maxWidth: '100%',
};

function getMenuStyle(menuPlacement: 'above' | 'below'): React.CSSProperties {
  return {
    position: 'absolute',
    ...(menuPlacement === 'above'
      ? { bottom: 'calc(100% + 0.5rem)' }
      : { top: 'calc(100% + 0.5rem)' }),
    right: 0,
    minWidth: '9.25rem',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '0.5rem',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    padding: '0.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    zIndex: 120,
  };
}

const iconGlyphStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 700,
  lineHeight: 1,
};

const triggerAvatarShellStyle: React.CSSProperties = {
  width: '1.65rem',
  height: '1.65rem',
  borderRadius: '999px',
  overflow: 'hidden',
  border: '1px solid rgba(56, 189, 248, 0.36)',
  background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.24), rgba(14, 165, 233, 0.24))',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const triggerAvatarImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-0.22rem',
  right: '-0.22rem',
  minWidth: '1rem',
  height: '1rem',
  borderRadius: '999px',
  background: '#dc2626',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.92)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 0.2rem',
  fontSize: '0.62rem',
  fontWeight: 700,
  lineHeight: 1,
};

const menuHeaderButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.375rem 0.5rem',
  borderBottom: '1px solid #e5e7eb',
  marginBottom: '0.25rem',
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: 'none',
  background: 'transparent',
  cursor: 'pointer',
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

const menuActionButtonStyle: React.CSSProperties = {
  padding: '0.5rem',
  background: 'transparent',
  border: 'none',
  color: '#0f172a',
  fontSize: '0.75rem',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  textAlign: 'center',
  borderRadius: '0.375rem',
};
