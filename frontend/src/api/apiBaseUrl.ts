function normalizeApiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function inferDefaultApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:8000';
}

export function resolveRequiredApiBaseUrl(overrideBaseUrl?: string): string {
  const override = (overrideBaseUrl ?? '').trim();
  if (override) {
    return normalizeApiBaseUrl(override);
  }

  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const normalizedConfigured = configured.trim();
  if (normalizedConfigured) {
    return normalizeApiBaseUrl(normalizedConfigured);
  }

  return normalizeApiBaseUrl(inferDefaultApiBaseUrl());
}

export const API_BASE_URL = resolveRequiredApiBaseUrl();
