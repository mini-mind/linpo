import type React from 'react';
import { useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface SessionActionsProps {
  sessionKey: string;
  onReset: () => Promise<void>;
  onDelete: () => Promise<void>;
  onPause?: () => Promise<void>;
  showPauseButton?: boolean;
  isPausing?: boolean;
  disabled?: boolean;
}

type ActionType = 'reset' | 'delete' | null;

interface ActionState {
  type: ActionType;
  status: 'idle' | 'loading' | 'success' | 'failed';
  errorMessage: string | null;
}

export function SessionActions({
  sessionKey,
  onReset,
  onDelete,
  onPause,
  showPauseButton = false,
  isPausing = false,
  disabled = false,
}: SessionActionsProps): JSX.Element {
  const isMobile = useIsMobile();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ActionType>(null);
  const [actionState, setActionState] = useState<ActionState>({
    type: null,
    status: 'idle',
    errorMessage: null,
  });

  const handleOpenResetConfirm = (): void => {
    setConfirmAction('reset');
    setShowConfirmModal(true);
    setActionState({ type: null, status: 'idle', errorMessage: null });
  };

  const handleOpenDeleteConfirm = (): void => {
    setConfirmAction('delete');
    setShowConfirmModal(true);
    setActionState({ type: null, status: 'idle', errorMessage: null });
  };

  const handleCloseModal = (): void => {
    if (actionState.status === 'loading') return;
    setShowConfirmModal(false);
    setConfirmAction(null);
  };

  const handleConfirm = async (): Promise<void> => {
    if (!confirmAction) return;

    setActionState({
      type: confirmAction,
      status: 'loading',
      errorMessage: null,
    });

    try {
      if (confirmAction === 'reset') {
        await onReset();
      } else {
        await onDelete();
      }

      setActionState({
        type: confirmAction,
        status: 'success',
        errorMessage: null,
      });

      setTimeout(() => {
        setShowConfirmModal(false);
        setConfirmAction(null);
        setActionState({ type: null, status: 'idle', errorMessage: null });
      }, 1500);
    } catch (error) {
      setActionState({
        type: confirmAction,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : '操作失败',
      });
    }
  };

  const isLoading = actionState.status === 'loading';
  const isSuccess = actionState.status === 'success';
  const isFailed = actionState.status === 'failed';

  return (
    <div style={containerStyle}>
      <div style={getButtonsContainerStyle(isMobile)}>
        {showPauseButton && (
          <button
            type="button"
            style={
              disabled || isPausing
                ? getDisabledButtonStyle(isMobile)
                : dangerButtonStyle
            }
            onClick={onPause}
            disabled={disabled || isPausing}
          >
            <span style={buttonIconStyle}>⏸</span>
            {isPausing ? '暂停中...' : '暂停'}
          </button>
        )}
        <button
          type="button"
          style={
            disabled || isLoading
              ? getDisabledButtonStyle(isMobile)
              : warningButtonStyle
          }
          onClick={handleOpenResetConfirm}
          disabled={disabled || isLoading}
        >
          <span style={buttonIconStyle}>↺</span>
          重置会话
        </button>
        <button
          type="button"
          style={
            disabled || isLoading
              ? getDisabledButtonStyle(isMobile)
              : dangerButtonStyle
          }
          onClick={handleOpenDeleteConfirm}
          disabled={disabled || isLoading}
        >
          <span style={buttonIconStyle}>🗑</span>
          删除会话
        </button>
      </div>

      {showConfirmModal && (
        <div
          style={modalOverlayStyle}
          onClick={handleCloseModal}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleCloseModal();
          }}
          aria-hidden="true"
        >
          <div
            style={getModalStyle(isMobile)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={() => {}}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
          >
            <div style={modalHeaderStyle}>
              <h2 style={modalTitleStyle} id="confirm-modal-title">
                {confirmAction === 'reset' ? '确认重置会话' : '确认删除会话'}
              </h2>
              <button
                type="button"
                style={closeButtonStyle}
                onClick={handleCloseModal}
                disabled={isLoading}
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div style={modalBodyStyle}>
              <p style={confirmTextStyle}>
                {confirmAction === 'reset'
                  ? '重置会话将清除所有历史消息，但保留会话配置。此操作不可撤销。'
                  : '删除会话将永久移除会话及其所有数据。此操作不可撤销。'}
              </p>

              <div style={infoRowStyle}>
                <span style={infoLabelStyle}>会话 Key</span>
                <span style={infoValueStyle}>{sessionKey}</span>
              </div>

              {isFailed && actionState.errorMessage && (
                <div style={errorMessageStyle}>
                  <span style={errorIconStyle}>⚠</span>
                  {actionState.errorMessage}
                </div>
              )}

              {isSuccess && (
                <div style={successMessageStyle}>
                  <span style={successIconStyle}>✓</span>
                  {confirmAction === 'reset' ? '重置成功' : '删除成功'}
                </div>
              )}
            </div>

            <div style={modalFooterStyle}>
              <button
                type="button"
                style={cancelButtonStyle}
                onClick={handleCloseModal}
                disabled={isLoading}
              >
                取消
              </button>
              <button
                type="button"
                style={
                  confirmAction === 'reset'
                    ? isLoading
                      ? getDisabledButtonStyle(isMobile)
                      : warningButtonStyle
                    : isLoading
                      ? getDisabledButtonStyle(isMobile)
                      : dangerButtonStyle
                }
                onClick={() => void handleConfirm()}
                disabled={isLoading}
              >
                {isLoading
                  ? '处理中...'
                  : confirmAction === 'reset'
                    ? '确认重置'
                    : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

function getButtonsContainerStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    gap: isMobile ? '0.5rem' : '0.75rem',
    flexDirection: isMobile ? 'column' : 'row',
  };
}

const buttonIconStyle: React.CSSProperties = {
  marginRight: '0.25rem',
};

const warningButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  borderRadius: '0.375rem',
  border: 'none',
  background: '#f97316',
  color: '#fff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.2s, opacity 0.2s',
};

const dangerButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  borderRadius: '0.375rem',
  border: 'none',
  background: '#ef4444',
  color: '#fff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.2s, opacity 0.2s',
};

function getDisabledButtonStyle(isMobile: boolean): React.CSSProperties {
  return {
    padding: isMobile ? '0.5rem 0.875rem' : '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    borderRadius: '0.375rem',
    border: 'none',
    background: '#e5e7eb',
    color: '#9ca3af',
    cursor: 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
};

function getModalStyle(isMobile: boolean): React.CSSProperties {
  return {
    background: '#fff',
    borderRadius: '0.75rem',
    width: isMobile ? 'calc(100% - 2rem)' : '420px',
    maxWidth: '90%',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    overflow: 'hidden',
  };
}

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '1rem 1.25rem',
  borderBottom: '1px solid #e5e7eb',
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  color: '#1f2933',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '0.375rem',
  border: 'none',
  background: 'transparent',
  color: '#6b7280',
  fontSize: '1.5rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
};

const modalBodyStyle: React.CSSProperties = {
  padding: '1.25rem',
};

const confirmTextStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#4b5563',
  margin: '0 0 1rem 0',
  lineHeight: 1.6,
};

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.75rem',
  background: '#f9fafb',
  borderRadius: '0.375rem',
  marginBottom: '1rem',
};

const infoLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#6b7280',
  fontWeight: 500,
};

const infoValueStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#1f2933',
  fontWeight: 600,
  fontFamily: 'monospace',
  maxWidth: '200px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const errorMessageStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.75rem',
  background: '#fee2e2',
  borderRadius: '0.375rem',
  color: '#991b1b',
  fontSize: '0.875rem',
};

const errorIconStyle: React.CSSProperties = {
  fontSize: '1rem',
};

const successMessageStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.75rem',
  background: '#d1fae5',
  borderRadius: '0.375rem',
  color: '#065f46',
  fontSize: '0.875rem',
};

const successIconStyle: React.CSSProperties = {
  fontSize: '1rem',
};

const modalFooterStyle: React.CSSProperties = {
  padding: '1rem 1.25rem',
  borderTop: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.75rem',
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  borderRadius: '0.375rem',
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#6b7280',
  cursor: 'pointer',
  transition: 'background 0.2s',
};
