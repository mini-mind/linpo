import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAggregateOverview,
  listAgents,
  patchSession,
  previewSessions,
} from './client';

const fetchMock = vi.fn();

describe('business API client instance context', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    window.localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('injects storage instance context into observer requests', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [],
    });

    await listAgents();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/agents?data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('injects storage instance context into aggregate requests', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        request_id: 'req-1',
        freshness: { status: 'fresh', checked_at: '2026-03-22T12:00:00Z' },
        partial_failure: false,
        diagnostics: [],
        agents: [],
      }),
    });

    await getAggregateOverview();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/aggregate/overview?data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends previewSessions keys as comma-separated query parameter', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ts: 123, previews: [] }),
    });

    await previewSessions(['session-a', 'session-b']);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/chat/sessions/preview?keys=session-a%2Csession-b&maxChars=2000&data_source=openclaw',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('patchSession throws ApiError with envelope when backend returns error envelope', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({
        error: {
          code: 'not_found',
          message: 'Session not found',
          request_id: 'req-404',
          recoverable: false,
          next_step: '确认目标资源仍存在后重试',
        },
      }),
    });

    await expect(patchSession('missing-session', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Session not found',
      envelope: expect.objectContaining({
        code: 'not_found',
        request_id: 'req-404',
      }),
    });
  });
});
