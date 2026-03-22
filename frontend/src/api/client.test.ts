import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAggregateOverview, listAgents } from './client';

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
});
