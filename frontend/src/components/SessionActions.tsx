import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { useIsMobile } from '../hooks/useIsMobile';

interface SessionActionsProps {
  sessionKey: string | null;
  onReset?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onPause?: () => Promise<void>;
  showPauseButton?: boolean;
  disabled?: boolean;
}

type ActionKey = 'pause' | 'reset' | 'delete';

function getActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '当前操作失败，请稍后重试';
}

export function SessionActions({
  sessionKey,
  onReset,
  onDelete,
  onPause,
  showPauseButton = true,
  disabled = false,
}: SessionActionsProps): JSX.Element {
  const isMobile = useIsMobile();
  const [busyAction, setBusyAction] = useState<ActionKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBlocked = disabled || !sessionKey;
  const hasAction =
    (showPauseButton && typeof onPause === 'function') ||
    typeof onReset === 'function' ||
    typeof onDelete === 'function';
  const actionHint = useMemo(() => {
    if (!hasAction) return '当前后端暂未开放会话操作接口';
    if (!sessionKey) return '请选择会话后再执行操作';
    return '操作会直接作用于当前会话，请谨慎执行';
  }, [hasAction, sessionKey]);

  const runAction = useCallback(
    async (action: ActionKey, handler?: () => Promise<void>): Promise<void> => {
      if (!handler || busyAction || isBlocked) return;
      setBusyAction(action);
      setErrorMessage(null);
      try {
        await handler();
      } catch (error) {
        setErrorMessage(getActionErrorMessage(error));
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, isBlocked],
  );

  return (
    <div style={containerStyle}>
      <span style={hintTextStyle}>{actionHint}</span>
      {hasAction ? (
        <div style={buttonGroupStyle}>
          {showPauseButton && onPause ? (
            <button
              type="button"
              onClick={() => void runAction('pause', onPause)}
              disabled={Boolean(busyAction) || isBlocked}
              style={getActionButtonStyle('default', Boolean(busyAction) || isBlocked)}
            >
              {busyAction === 'pause' ? '暂停中...' : '暂停'}
            </button>
          ) : null}
          {onReset ? (
            <button
              type="button"
              onClick={() => void runAction('reset', onReset)}
              disabled={Boolean(busyAction) || isBlocked}
              style={getActionButtonStyle('default', Boolean(busyAction) || isBlocked)}
            >
              {busyAction === 'reset' ? '重置中...' : '重置会话'}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={() => void runAction('delete', onDelete)}
              disabled={Boolean(busyAction) || isBlocked}
              style={getActionButtonStyle('danger', Boolean(busyAction) || isBlocked)}
            >
              {busyAction === 'delete' ? '删除中...' : '删除会话'}
            </button>
          ) : null}
        </div>
      ) : null}
      {sessionKey ? (
        <div style={getMetaStyle(isMobile)}>
          <span style={metaLabelStyle}>当前会话</span>
          <span style={metaValueStyle}>{sessionKey}</span>
        </div>
      ) : null}
      {errorMessage ? (
        <div role="alert" style={errorNoticeStyle}>
          操作失败：{errorMessage}
        </div>
      ) : null}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

const hintTextStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#64748b',
  lineHeight: 1.5,
};

const buttonGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
};

function getActionButtonStyle(
  variant: 'default' | 'danger',
  disabled: boolean,
): React.CSSProperties {
  const palette =
    variant === 'danger'
      ? {
          color: '#991b1b',
          borderColor: '#fecaca',
          background: '#fff1f2',
        }
      : {
          color: '#1f2937',
          borderColor: '#e5e7eb',
          background: '#f8fafc',
        };
  return {
    border: `1px solid ${palette.borderColor}`,
    background: disabled ? '#f8fafc' : palette.background,
    color: disabled ? '#94a3b8' : palette.color,
    borderRadius: '0.5rem',
    height: '2rem',
    padding: '0 0.75rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function getMetaStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    gap: isMobile ? '0.25rem' : '0.5rem',
    alignItems: isMobile ? 'flex-start' : 'center',
    padding: '0 0.125rem',
  };
}

const metaLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#64748b',
};

const metaValueStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#0f172a',
  wordBreak: 'break-all',
};

const errorNoticeStyle: React.CSSProperties = {
  border: '1px solid #fecaca',
  background: '#fff1f2',
  color: '#991b1b',
  borderRadius: '0.5rem',
  padding: '0.5rem 0.625rem',
  fontSize: '0.75rem',
  lineHeight: 1.5,
};
