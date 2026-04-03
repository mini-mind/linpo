function normalizeApiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
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

  throw new Error(
    'Missing VITE_API_BASE_URL. Please configure frontend/.env or frontend/.env.local before starting the frontend.'
  );
}

export const API_BASE_URL = resolveRequiredApiBaseUrl();
