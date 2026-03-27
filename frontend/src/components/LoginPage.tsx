import type React from 'react';
import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

type AuthMode = 'login' | 'register';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, error: authError, clearError, loading } = useAuth();
  const { addToast } = useToast();

  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/kanban';

  const handleModeToggle = useCallback(() => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
    clearError();
    setUsername('');
    setPassword('');
    setConfirmPassword('');
  }, [clearError]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      clearError();

      if (!username.trim() || !password.trim()) {
        addToast('请输入用户名和密码', 'warning');
        return;
      }

      if (mode === 'register') {
        if (password !== confirmPassword) {
          addToast('两次输入的密码不一致', 'warning');
          return;
        }
        if (password.length < 6) {
          addToast('密码长度至少为6位', 'warning');
          return;
        }
      }

      try {
        if (mode === 'login') {
          await login({ username: username.trim(), password });
          addToast('登录成功', 'success');
        } else {
          await register({ username: username.trim(), password });
          addToast('注册成功', 'success');
        }
        navigate(from, { replace: true });
      } catch {
        // Error is already handled by useAuth and shown via authError
      }
    },
    [username, password, confirmPassword, mode, login, register, clearError, addToast, navigate, from]
  );

  const isLogin = mode === 'login';
  const title = isLogin ? '登录到灵盘' : '注册账号';
  const buttonText = loading ? '处理中...' : isLogin ? '登录' : '注册';
  const toggleText = isLogin ? '注册新账号' : '已有账号？去登录';

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <span style={logoStyle}>灵</span>
          <h1 style={titleStyle}>{title}</h1>
        </div>

        <form onSubmit={handleSubmit} style={formStyle}>
          <div style={inputGroupStyle}>
            <input
              type="text"
              placeholder="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
          </div>

          <div style={inputGroupStyle}>
            <input
              type="password"
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
          </div>

          {!isLogin && (
            <div style={inputGroupStyle}>
              <input
                type="password"
                placeholder="确认密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
                disabled={loading}
              />
            </div>
          )}

          {authError && (
            <div style={errorStyle}>{authError}</div>
          )}

          <button
            type="submit"
            style={submitButtonStyle}
            disabled={loading || !username.trim() || !password.trim()}
          >
            {buttonText}
          </button>
        </form>

        <button
          type="button"
          onClick={handleModeToggle}
          style={toggleButtonStyle}
          disabled={loading}
        >
          {toggleText}
        </button>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f4f1ea',
  padding: '1rem',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '360px',
  background: '#fff',
  borderRadius: '1rem',
  padding: '2rem',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
};

const headerStyle: React.CSSProperties = {
  textAlign: 'center',
  marginBottom: '1.5rem',
};

const logoStyle: React.CSSProperties = {
  fontSize: '2.5rem',
  fontWeight: 700,
  color: '#3b82f6',
  display: 'inline-block',
  marginBottom: '0.5rem',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 600,
  color: '#1f2933',
  margin: 0,
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  marginBottom: '1rem',
};

const inputGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const inputStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  border: '1px solid #e5e7eb',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  color: '#1f2933',
  background: '#fff',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  outline: 'none',
};

const submitButtonStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#3b82f6',
  color: '#fff',
  border: 'none',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  cursor: 'pointer',
  transition: 'background 0.2s, opacity 0.2s',
  marginTop: '0.5rem',
};

const toggleButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem',
  background: 'transparent',
  border: 'none',
  color: '#3b82f6',
  fontSize: '0.875rem',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
};

const errorStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: '#fee2e2',
  border: '1px solid #fecaca',
  borderRadius: '0.5rem',
  color: '#991b1b',
  fontSize: '0.875rem',
  textAlign: 'center',
};
