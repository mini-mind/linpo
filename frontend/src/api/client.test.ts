import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatSend, listAgents } from './client';

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

  it('injects storage instance context into chat requests', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ request_id: 'req-1', agent_id: 'main', status: 'accepted' }),
    });

    await chatSend('main', 'agent:main:main', 'hello');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/chat/send?agentId=main&sessionKey=agent%3Amain%3Amain&data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });
});
