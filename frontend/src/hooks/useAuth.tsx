/**
 * Auth context and hook for managing authentication state
 * Provides: user, loading, login, logout, refresh
 */
import type React from 'react';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getCurrentUser, login, logout, register, type User, type Credentials, AuthError } from '../api/authClient';
import { clearStoredCurrentInstanceId } from './useCurrentInstance';

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (credentials: Credentials) => Promise<void>;
  register: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialCheckDone = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch {
      clearStoredCurrentInstanceId();
      setUser(null);
    }
  }, []);

  // Check auth status on mount
  useEffect(() => {
    if (initialCheckDone.current) return;
    initialCheckDone.current = true;
    
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const handleLogin = useCallback(async (credentials: Credentials) => {
    setLoading(true);
    setError(null);
    try {
      const loggedInUser = await login(credentials);
      clearStoredCurrentInstanceId();
      setUser(loggedInUser);
    } catch (e) {
      if (e instanceof AuthError) {
        // Map error codes to Chinese messages
        const messageMap: Record<string, string> = {
          unauthorized: '用户名或密码错误',
          conflict: '用户名已存在',
          network_error: '网络错误，请重试',
          unknown: '登录失败，请重试',
        };
        setError(messageMap[e.code] || e.message);
      } else {
        setError('登录失败，请重试');
      }
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRegister = useCallback(async (credentials: Credentials) => {
    setLoading(true);
    setError(null);
    try {
      const newUser = await register(credentials);
      clearStoredCurrentInstanceId();
      setUser(newUser);
    } catch (e) {
      if (e instanceof AuthError) {
        const messageMap: Record<string, string> = {
          unauthorized: '未登录',
          conflict: '用户名已存在',
          network_error: '网络错误，请重试',
          unknown: '注册失败，请重试',
        };
        setError(messageMap[e.code] || e.message);
      } else {
        setError('注册失败，请重试');
      }
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    setLoading(true);
    try {
      await logout();
      clearStoredCurrentInstanceId();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      login: handleLogin,
      register: handleRegister,
      logout: handleLogout,
      refresh,
      clearError,
    }),
    [user, loading, error, handleLogin, handleRegister, handleLogout, refresh, clearError]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

/**
 * Hook for protected route guarding
 * Returns true if user is authenticated, false otherwise
 * Can be used to redirect unauthenticated users
 */
export function useRequireAuth(): { authenticated: boolean; loading: boolean } {
  const { user, loading } = useAuth();
  return { authenticated: !!user, loading };
}
