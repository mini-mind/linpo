import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstanceItem } from '../api/types';
import { resolveSingleInstance } from '../api/instanceClient';

type AccountMenuProps = {
  compact?: boolean;
  menuPlacement?: 'above' | 'below';
  triggerVariant?: 'username' | 'icon';
};

export function AccountMenu({
  compact = false,
  menuPlacement = 'above',
  triggerVariant = 'username',
}: AccountMenuProps = {}): JSX.Element {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [instance, setInstance] = useState<InstanceItem | null>(null);
  const [instanceCount, setInstanceCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  const loadInstance = useCallback(async () => {
    try {
      const result = await resolveSingleInstance();
      setInstance(result.instance);
      setInstanceCount(result.total);
      setLoadError(null);
    } catch (error) {
      setInstance(null);
      setInstanceCount(null);
      setLoadError(error instanceof Error ? error.message : '读取实例失败');
    }
  }, []);

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

  useEffect(() => {
    void loadInstance();
  }, [loadInstance]);

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

  return (
    <div style={getContainerStyle(compact)} ref={menuRef}>
      <button
        type="button"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
        style={getTriggerButtonStyle(compact)}
        aria-label="打开实例信息"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        ref={triggerButtonRef}
      >
        {triggerVariant === 'icon' ? (
          <span style={triggerIconShellStyle} aria-hidden="true">
            <img src="/assets/brand/openclaw-icon.svg" alt="" style={triggerIconImageStyle} />
          </span>
        ) : null}
        <span style={triggerLabelStyle}>{resolveTriggerLabel(instance, instanceCount)}</span>
      </button>

      {isMenuOpen && (
        <div style={getMenuStyle(menuPlacement)} role="menu" aria-label="实例信息" onKeyDown={handleMenuKeyDown}>
          <div style={menuHeaderStyle}>当前 OpenClaw 实例</div>
          {renderInstanceDetail(instance, instanceCount, loadError)}
          <button
            type="button"
            style={refreshButtonStyle}
            role="menuitem"
            onClick={() => {
              void loadInstance();
            }}
          >
            刷新实例信息
          </button>
        </div>
      )}
    </div>
  );
}

function resolveTriggerLabel(instance: InstanceItem | null, count: number | null): string {
  if (instance?.name?.trim()) {
    return instance.name.trim();
  }
  if (count === null) {
    return '实例信息';
  }
  if (count === 0) {
    return '未配置实例';
  }
  if (count > 1) {
    return `实例异常 (${count})`;
  }
  return '实例信息';
}

function renderInstanceDetail(instance: InstanceItem | null, count: number | null, loadError: string | null): JSX.Element {
  if (loadError) {
    return <p style={hintStyle}>读取失败：{loadError}</p>;
  }

  if (!instance && count === 0) {
    return <p style={hintStyle}>未检测到实例，请先在服务端配置 1 个 OpenClaw 实例。</p>;
  }

  if (!instance && typeof count === 'number' && count > 1) {
    return <p style={hintStyle}>检测到 {count} 个实例。当前版本仅支持单实例，请保留 1 个。</p>;
  }

  if (!instance) {
    return <p style={hintStyle}>正在读取实例信息...</p>;
  }

  return (
    <dl style={detailListStyle}>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>名称</dt>
        <dd style={detailValueStyle}>{instance.name || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>ID</dt>
        <dd style={detailValueStyle}>{instance.id || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>类型</dt>
        <dd style={detailValueStyle}>{instance.type || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>Endpoint</dt>
        <dd style={detailValueStyle}>{instance.endpoint || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>状态</dt>
        <dd style={detailValueStyle}>{instance.status || '-'}</dd>
      </div>
    </dl>
  );
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
      height: '2.125rem',
      maxWidth: '14rem',
      borderRadius: '999px',
      position: 'relative',
      border: '1px solid #dbe4ef',
      background: 'rgba(255, 255, 255, 0.95)',
      color: '#0f172a',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.4rem',
      cursor: 'pointer',
      fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      boxShadow: '0 10px 24px -20px rgba(15, 23, 42, 0.6)',
      padding: '0 0.65rem 0 0.35rem',
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
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.45rem',
  };
}

function getMenuStyle(menuPlacement: 'above' | 'below'): React.CSSProperties {
  return {
    position: 'absolute',
    ...(menuPlacement === 'above'
      ? { bottom: 'calc(100% + 0.5rem)' }
      : { top: 'calc(100% + 0.5rem)' }),
    right: 0,
    minWidth: '19rem',
    maxWidth: '24rem',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '0.5rem',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    padding: '0.65rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.45rem',
    zIndex: 120,
  };
}

const triggerIconShellStyle: React.CSSProperties = {
  width: '1.55rem',
  height: '1.55rem',
  borderRadius: '999px',
  overflow: 'hidden',
  border: '1px solid rgba(56, 189, 248, 0.36)',
  background: '#ffffff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const triggerIconImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const triggerLabelStyle: React.CSSProperties = {
  maxWidth: '10rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.78rem',
  fontWeight: 600,
};

const menuHeaderStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#0f172a',
  fontWeight: 700,
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.73rem',
  lineHeight: 1.5,
  color: '#4b5563',
};

const detailListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '0.35rem',
};

const detailRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '4.5rem 1fr',
  gap: '0.45rem',
  alignItems: 'start',
};

const detailKeyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#6b7280',
};

const detailValueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#0f172a',
  wordBreak: 'break-all',
};

const refreshButtonStyle: React.CSSProperties = {
  border: '1px solid #d5dee9',
  borderRadius: '0.45rem',
  background: '#f8fafc',
  color: '#0f172a',
  fontSize: '0.74rem',
  padding: '0.3rem 0.5rem',
  cursor: 'pointer',
  alignSelf: 'flex-end',
};
