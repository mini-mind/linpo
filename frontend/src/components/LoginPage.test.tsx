import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import { ProtectedRoute, PublicRoute } from '../routes';
import { LoginPage } from './LoginPage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{location.pathname}</div>;
}

function renderLoginPageWithMemoryRouter(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <AuthProvider>
          <LocationDisplay />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/summary" element={<div>summary-page</div>} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('LoginPage auth flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Unauthorized' }),
    });
  });

  it('shows login form by default', async () => {
    render(
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    );

    expect(await screen.findByText('登录到灵盘')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('用户名或邮箱')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('密码')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('toggles to register form when clicking register link', async () => {
    render(
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    );

    expect(await screen.findByText('登录到灵盘')).toBeInTheDocument();

    const registerLink = screen.getByText('注册新账号');
    await userEvent.click(registerLink);

    expect(await screen.findByText('注册账号')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument();

    const loginLink = screen.getByText('已有账号？去登录');
    await userEvent.click(loginLink);

    expect(await screen.findByText('登录到灵盘')).toBeInTheDocument();
  });

  it('calls login API and redirects to /summary on valid credentials', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'stale-instance');
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'user-1', username: 'alice' }),
      });

    renderLoginPageWithMemoryRouter();

    await screen.findByRole('button', { name: '登录' });

    const usernameInput = screen.getByPlaceholderText('用户名或邮箱');
    const passwordInput = screen.getByPlaceholderText('密码');
    const loginButton = screen.getByRole('button', { name: '登录' });

    await userEvent.type(usernameInput, 'alice');
    await userEvent.type(passwordInput, 'secret123');
    await userEvent.click(loginButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/login'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'alice', password: 'secret123' }),
        })
      );
    });

    expect(window.localStorage.getItem('linpo.currentInstanceId')).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId('location-display')).toHaveTextContent('/summary');
    });
  });

  it('calls register API and redirects to /summary on valid input', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'user-1', username: 'bob' }),
      });

    renderLoginPageWithMemoryRouter();

    const registerLink = await screen.findByText('注册新账号');
    await userEvent.click(registerLink);

    const usernameInput = screen.getByPlaceholderText('用户名');
    const emailInput = screen.getByPlaceholderText('邮箱');
    const passwordInput = screen.getByPlaceholderText('密码');
    const confirmInput = screen.getByPlaceholderText('确认密码');
    const registerButton = screen.getByRole('button', { name: '注册' });

    await userEvent.type(usernameInput, 'bob');
    await userEvent.type(emailInput, 'bob@example.com');
    await userEvent.type(passwordInput, 'password123');
    await userEvent.type(confirmInput, 'password123');
    await userEvent.click(registerButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/register'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'bob', email: 'bob@example.com', password: 'password123' }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('location-display')).toHaveTextContent('/summary');
    });
  });

  it('shows error on login failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid username or password' }),
    });

    render(
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    );

    await screen.findByRole('button', { name: '登录' });

    const usernameInput = screen.getByPlaceholderText('用户名或邮箱');
    const passwordInput = screen.getByPlaceholderText('密码');
    const loginButton = screen.getByRole('button', { name: '登录' });

    await userEvent.type(usernameInput, 'alice');
    await userEvent.type(passwordInput, 'wrongpassword');
    await userEvent.click(loginButton);

    expect(await screen.findByText('账号或密码错误')).toBeInTheDocument();
  });

  it('shows error on duplicate username', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Username already exists' }),
    });

    render(
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    );

    const registerLink = await screen.findByText('注册新账号');
    await userEvent.click(registerLink);

    const usernameInput = screen.getByPlaceholderText('用户名');
    const emailInput = screen.getByPlaceholderText('邮箱');
    const passwordInput = screen.getByPlaceholderText('密码');
    const confirmInput = screen.getByPlaceholderText('确认密码');
    const registerButton = screen.getByRole('button', { name: '注册' });

    await userEvent.type(usernameInput, 'existinguser');
    await userEvent.type(emailInput, 'existing@example.com');
    await userEvent.type(passwordInput, 'password123');
    await userEvent.type(confirmInput, 'password123');
    await userEvent.click(registerButton);

    expect(await screen.findByText('用户名或邮箱已存在')).toBeInTheDocument();
  });
});

describe('Route guarding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('redirects unauthenticated users from protected routes to /login', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Unauthorized' }),
    });

    function ProtectedPage() {
      return <div>受保护的内容</div>;
    }

    function App() {
      return (
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/protected" element={<ProtectedPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      );
    }

    window.history.pushState({}, '', '/protected');
    render(<App />);

    expect(await screen.findByText('登录到灵盘')).toBeInTheDocument();
  });

  it('allows authenticated users to access protected routes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'alice' }),
    });

    function ProtectedPage() {
      return <div>欢迎, alice</div>;
    }

    function App() {
      return (
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/protected" element={<ProtectedPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      );
    }

    window.history.pushState({}, '', '/protected');
    render(<App />);

    expect(await screen.findByText('欢迎, alice')).toBeInTheDocument();
  });

  it('redirects authenticated users from /login to /summary by default', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'alice' }),
    });

    function App() {
      return (
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/login']}>
              <LocationDisplay />
              <Routes>
                <Route element={<PublicRoute />}>
                  <Route path="/login" element={<LoginPage />} />
                </Route>
                <Route path="/summary" element={<div>摘要页内容</div>} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>
      );
    }

    render(<App />);

    expect(await screen.findByText('摘要页内容')).toBeInTheDocument();
    expect(screen.getByTestId('location-display')).toHaveTextContent('/summary');
  });

  it('redirects unauthenticated root access to /landing', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Unauthorized' }),
    });

    function LandingPage() {
      return <div>landing-page</div>;
    }

    function App() {
      return (
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/landing" element={<LandingPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/" element={<div>root-protected</div>} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      );
    }

    window.history.pushState({}, '', '/');
    render(<App />);

    expect(await screen.findByText('landing-page')).toBeInTheDocument();
  });
});
