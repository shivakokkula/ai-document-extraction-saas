import { apiClient } from './api-client';

export interface AuthTokens { accessToken: string; refreshToken: string; }
export interface User { id: string; email: string; fullName?: string; role: string; organizationId: string; }

export async function login(email: string, password: string): Promise<AuthTokens> {
  const tokens = await apiClient.post<AuthTokens>('/auth/login', { email, password });
  localStorage.setItem('access_token', tokens.accessToken);
  localStorage.setItem('refresh_token', tokens.refreshToken);
  return tokens;
}

export async function register(email: string, password: string, fullName?: string): Promise<AuthTokens> {
  const tokens = await apiClient.post<AuthTokens>('/auth/register', { email, password, fullName });
  localStorage.setItem('access_token', tokens.accessToken);
  localStorage.setItem('refresh_token', tokens.refreshToken);
  return tokens;
}

export async function logout(refreshToken: string) {
  try {
    await apiClient.post('/auth/logout', { refreshToken });
  } catch {
    // Ignore logout API errors to ensure client state clears.
  } finally {
    localStorage.clear();
  }
}

export function getStoredTokens() {
  if (typeof window === 'undefined') return null;
  const accessToken = localStorage.getItem('access_token');
  const refreshToken = localStorage.getItem('refresh_token');
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}
