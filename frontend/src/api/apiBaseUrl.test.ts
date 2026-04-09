import { describe, expect, it, vi } from 'vitest';

import { resolveRequiredApiBaseUrl } from './apiBaseUrl';

describe('resolveRequiredApiBaseUrl', () => {
  it('returns explicit override first', () => {
    expect(resolveRequiredApiBaseUrl(' http://example.test:9000/ ')).toBe('http://example.test:9000');
  });

  it('returns configured VITE_API_BASE_URL when present', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://configured.test:7000/');
    expect(resolveRequiredApiBaseUrl()).toBe('http://configured.test:7000');
    vi.unstubAllEnvs();
  });

  it('falls back to current origin when VITE_API_BASE_URL is missing', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    expect(resolveRequiredApiBaseUrl()).toBe(window.location.origin);
    vi.unstubAllEnvs();
  });
});
