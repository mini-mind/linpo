/**
 * Auth API client for authentication operations
 * Backend API: /auth/* with cookie-based session
 */

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const inferredApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE_URL = configuredApiBaseUrl || inferredApiBaseUrl;

export interface User {
  id: string;
  username: string;
}

export interface Credentials {
  username: string;
  password: string;
}

type AuthErrorCode = 
  | 'unauthorized' 
  | 'conflict' 
  | 'network_error' 
  | 'unknown';

export class AuthError extends Error {
  constructor(
    message: string,
    public code: AuthErrorCode,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include', // Include cookies for session
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    
    if (response.status === 401) {
      throw new AuthError(data.detail || '未登录', 'unauthorized', 401);
    }
    if (response.status === 409) {
      throw new AuthError(data.detail || '用户名已存在', 'conflict', 409);
    }
    
    throw new AuthError(
      data.detail || `请求失败: ${response.status}`,
      'unknown',
      response.status
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Get current user info
 * Returns null if not authenticated
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return await fetchApi<User>('/auth/me');
  } catch (error) {
    if (error instanceof AuthError && error.code === 'unauthorized') {
      return null;
    }
    throw error;
  }
}

/**
 * Login with username and password
 * Sets session cookie on success
 */
export async function login(credentials: Credentials): Promise<User> {
  return fetchApi<User>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

/**
 * Register new user
 */
export async function register(credentials: Credentials): Promise<User> {
  return fetchApi<User>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

/**
 * Logout current user
 * Clears session cookie
 */
export async function logout(): Promise<void> {
  await fetchApi<{ ok: boolean }>('/auth/logout', {
    method: 'POST',
  });
}
