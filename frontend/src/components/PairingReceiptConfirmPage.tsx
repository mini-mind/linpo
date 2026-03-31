import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

type ConfirmState = 'processing' | 'success' | 'error';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const inferredApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE_URL = configuredApiBaseUrl || inferredApiBaseUrl;

async function confirmReceipt(token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/instances/agent-receipts/${encodeURIComponent(token)}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || data.message || `确认失败: ${response.status}`);
  }
}

export function PairingReceiptConfirmPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<ConfirmState>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const runConfirm = useCallback(async () => {
    if (!token) {
      setState('error');
      setErrorMessage('缺少回执 token，无法确认。');
      return;
    }

    setState('processing');
    setErrorMessage('');
    try {
      await confirmReceipt(token);
      setState('success');
    } catch (error) {
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : '回执确认失败');
    }
  }, [token]);

  useEffect(() => {
    void runConfirm();
  }, [runConfirm]);

  return (
    <section style={pageStyle} aria-label="pairing-receipt-confirm-page">
      <article style={cardStyle}>
        <h1 style={titleStyle}>配对回执确认</h1>
        {state === 'processing' ? <p style={textStyle}>正在确认，请稍候...</p> : null}
        {state === 'success' ? <p style={successTextStyle}>已确认成功。你可以返回实例页面继续管理配对。</p> : null}
        {state === 'error' ? <p style={errorTextStyle}>确认失败：{errorMessage || '未知错误'}</p> : null}

        <div style={actionsStyle}>
          {state === 'success' ? (
            <button type="button" style={primaryButtonStyle} onClick={() => navigate('/pairing')}>
              前往实例页
            </button>
          ) : null}
          {state === 'error' ? (
            <>
              <button type="button" style={ghostButtonStyle} onClick={() => void runConfirm()}>
                重试确认
              </button>
              <button type="button" style={primaryButtonStyle} onClick={() => navigate('/pairing')}>
                返回实例页
              </button>
            </>
          ) : null}
        </div>
      </article>
    </section>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f5f7fb',
  padding: '1rem',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '560px',
  background: '#ffffff',
  borderRadius: '14px',
  border: '1px solid #dce3ef',
  boxShadow: '0 12px 36px rgba(15, 23, 42, 0.08)',
  padding: '1.5rem',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: '1.5rem',
};

const textStyle: React.CSSProperties = {
  margin: '0.9rem 0 0',
  color: '#334155',
};

const successTextStyle: React.CSSProperties = {
  margin: '0.9rem 0 0',
  color: '#166534',
};

const errorTextStyle: React.CSSProperties = {
  margin: '0.9rem 0 0',
  color: '#b91c1c',
};

const actionsStyle: React.CSSProperties = {
  marginTop: '1.2rem',
  display: 'flex',
  gap: '0.75rem',
  flexWrap: 'wrap',
};

const primaryButtonStyle: React.CSSProperties = {
  appearance: 'none',
  border: 'none',
  borderRadius: '10px',
  padding: '0.62rem 1rem',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: '#f1f5f9',
  color: '#0f172a',
};
