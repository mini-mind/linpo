/**
 * Auth API client for authentication operations
 * Backend API: /api/v1/auth/* with cookie-based session
 */

import { API_BASE_URL } from './apiBaseUrl';

export interface User {
  id: string;
  username: string;
  email?: string | null;
  avatar_url?: string | null;
}

export interface LoginCredentials {
  identifier: string;
  password: string;
}

export interface RegisterCredentials {
  username: string;
  email: string;
  password: string;
}

export interface UpdateProfilePayload {
  username?: string;
  avatar_url?: string | null;
}

export interface UpdatePasswordPayload {
  current_password: string;
  new_password: string;
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
    return await fetchApi<User>('/api/v1/auth/me');
  } catch (error) {
    if (error instanceof AuthError && error.code === 'unauthorized') {
      return null;
    }
    throw error;
  }
}

/**
 * Login with identifier (username or email) and password
 * Sets session cookie on success
 */
export async function login(credentials: LoginCredentials): Promise<User> {
  return fetchApi<User>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

/**
 * Register new user
 */
export async function register(credentials: RegisterCredentials): Promise<User> {
  return fetchApi<User>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

/**
 * Logout current user
 * Clears session cookie
 */
export async function logout(): Promise<void> {
  await fetchApi<{ ok: boolean }>('/api/v1/auth/logout', {
    method: 'POST',
  });
}

export async function updateProfile(payload: UpdateProfilePayload): Promise<User> {
  return fetchApi<User>('/api/v1/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function updatePassword(payload: UpdatePasswordPayload): Promise<void> {
  await fetchApi<{ ok: boolean }>('/api/v1/auth/password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
