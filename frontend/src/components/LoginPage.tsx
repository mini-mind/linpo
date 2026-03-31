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
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/kanban';

  const handleModeToggle = useCallback(() => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
    clearError();
    setIdentifier('');
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  }, [clearError]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      clearError();

      if (mode === 'register') {
        if (!username.trim() || !email.trim() || !password.trim()) {
          addToast('请填写用户名、邮箱和密码', 'warning');
          return;
        }
        if (password !== confirmPassword) {
          addToast('两次输入的密码不一致', 'warning');
          return;
        }
        if (password.length < 6) {
          addToast('密码长度至少为6位', 'warning');
          return;
        }
      } else if (!identifier.trim() || !password.trim()) {
        addToast('请输入用户名/邮箱和密码', 'warning');
        return;
      }

      try {
        if (mode === 'login') {
          await login({ identifier: identifier.trim(), password });
          addToast('登录成功', 'success');
        } else {
          await register({ username: username.trim(), email: email.trim(), password });
          addToast('注册成功', 'success');
        }
        navigate(from, { replace: true });
      } catch {
        // Error is already handled by useAuth and shown via authError
      }
    },
    [identifier, username, email, password, confirmPassword, mode, login, register, clearError, addToast, navigate, from]
  );

  const isLogin = mode === 'login';
  const title = isLogin ? '登录到灵盘' : '注册账号';
  const buttonText = loading ? '处理中...' : isLogin ? '登录' : '注册';
  const toggleText = isLogin ? '注册新账号' : '已有账号？去登录';

  return (
    <div style={containerStyle}>
      <div style={orbOneStyle} aria-hidden />
      <div style={orbTwoStyle} aria-hidden />
      <div style={cardStyle}>
        <div style={headerStyle}>
          <img src="/assets/brand/linpo-flame-icon.svg" alt="" aria-hidden="true" style={logoStyle} />
          <h1 style={titleStyle}>{title}</h1>
          <p style={subtitleStyle}>登录后进入看板与流程协作空间</p>
        </div>

        <form onSubmit={handleSubmit} style={formStyle}>
          {isLogin ? (
            <div style={inputGroupStyle}>
              <input
                type="text"
                placeholder="用户名或邮箱"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                style={inputStyle}
                disabled={loading}
              />
            </div>
          ) : (
            <>
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
                  type="email"
                  placeholder="邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
            </>
          )}

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
            disabled={
              loading ||
              (isLogin
                ? !identifier.trim() || !password.trim()
                : !username.trim() || !email.trim() || !password.trim())
            }
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
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  overflow: 'hidden',
  background:
    'radial-gradient(1000px 700px at 10% -10%, rgba(16, 185, 129, 0.24), transparent 65%), radial-gradient(900px 700px at 95% 0%, rgba(14, 165, 233, 0.2), transparent 62%), linear-gradient(180deg, #f0f8fa 0%, #eef6f2 52%, #f6f8ef 100%)',
  padding: '1rem',
};

const orbOneStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-14rem',
  left: '-13rem',
  width: '34rem',
  height: '34rem',
  borderRadius: '50%',
  background: 'rgba(16, 185, 129, 0.18)',
  filter: 'blur(56px)',
  pointerEvents: 'none',
};

const orbTwoStyle: React.CSSProperties = {
  position: 'absolute',
  right: '-12rem',
  top: '-10rem',
  width: '30rem',
  height: '30rem',
  borderRadius: '50%',
  background: 'rgba(14, 165, 233, 0.18)',
  filter: 'blur(56px)',
  pointerEvents: 'none',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '390px',
  background: 'linear-gradient(165deg, rgba(255, 255, 255, 0.82) 0%, rgba(240, 253, 250, 0.62) 100%)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '1rem',
  padding: '2rem',
  boxShadow: '0 18px 38px rgba(15, 23, 42, 0.12)',
  position: 'relative',
  zIndex: 1,
};

const headerStyle: React.CSSProperties = {
  textAlign: 'center',
  marginBottom: '1.5rem',
};

const logoStyle: React.CSSProperties = {
  width: '3rem',
  height: '3rem',
  display: 'inline-block',
  marginBottom: '0.5rem',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 700,
  color: '#0f172a',
  margin: 0,
};

const subtitleStyle: React.CSSProperties = {
  margin: '0.45rem 0 0',
  fontSize: '0.82rem',
  color: '#52616f',
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
  border: '1px solid rgba(100, 116, 139, 0.28)',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  color: '#0f172a',
  background: 'rgba(255, 255, 255, 0.82)',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  outline: 'none',
};

const submitButtonStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#fff',
  border: '1px solid rgba(14, 116, 144, 0.5)',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 600,
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
  color: '#0c4a6e',
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
