import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  createKanbanTask,
  deleteSession,
  getAggregateOverview,
  getSessionHistory,
  listKanbanTasks,
  listAgents,
  pauseSession,
  patchSession,
  probeFlowPlannerSession,
  previewSessions,
  resetSession,
  stopFlowPlannerSession,
} from './client';
import { listInstances } from './instanceClient';
import { listUserMessages } from './messageClient';

const fetchMock = vi.fn();
const BOARD_ID = 'default';

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.get(String(key)) ?? null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(String(key));
    },
    setItem(key: string, value: string): void {
      store.set(String(key), String(value));
    },
  } as Storage;
}

function ensureTestLocalStorage(): Storage {
  const current = window.localStorage as Partial<Storage> | undefined;
  const isValidStorage = Boolean(
    current
      && typeof current.clear === 'function'
      && typeof current.getItem === 'function'
      && typeof current.key === 'function'
      && typeof current.removeItem === 'function'
      && typeof current.setItem === 'function'
  );
  if (isValidStorage) {
    return current as Storage;
  }

  const storage = createStorageMock();
  try {
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
  } catch {
    (window as { localStorage: Storage }).localStorage = storage;
  }
  return storage;
}

describe('business API client instance context', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    ensureTestLocalStorage().clear();
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
      'http://localhost:8000/api/v1/agents?data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('fails fast for agents requests when instanceId is missing', async () => {
    await expect(listAgents()).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'instanceId is required for agents/chat requests',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still fails fast for agents requests when disableInstanceContext is true but instanceId is missing', async () => {
    await expect(listAgents({ disableInstanceContext: true })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'instanceId is required for agents/chat requests',
    });
    expect(fetchMock).not.toHaveBeenCalled();
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
      'http://localhost:8000/api/v1/summary/overview?data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('supports aggregate requests without instance context when explicitly disabled', async () => {
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

    await getAggregateOverview({ disableInstanceContext: true });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/summary/overview?data_source=openclaw',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends previewSessions keys as comma-separated query parameter', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ts: 123, previews: [] }),
    });

    await previewSessions(['session-a', 'session-b']);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/sessions/preview?keys=session-a%2Csession-b&maxChars=2000&data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('fails fast for chat requests when instanceId is missing', async () => {
    await expect(previewSessions(['session-a'])).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'instanceId is required for agents/chat requests',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls session history endpoint for selected session', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ts: 123, items: [] }),
    });

    await getSessionHistory('agent:main:main');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/sessions/agent%3Amain%3Amain/history?limit=200&data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('patchSession throws ApiError with envelope when backend returns error envelope', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
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

  it('instance client throws ApiError and preserves envelope on 5xx errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => ({
        error: {
          code: 'source_error',
          message: 'Upstream service unavailable',
          request_id: 'req-502',
          recoverable: true,
          next_step: '稍后重试',
        },
      }),
    });

    const error = await listInstances().catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 502,
      message: 'Upstream service unavailable',
      envelope: expect.objectContaining({
        code: 'source_error',
        request_id: 'req-502',
      }),
    });
  });

  it('message client throws ApiError and preserves message on 4xx errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({
        message: 'Login required',
      }),
    });

    const error = await listUserMessages().catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: 'Login required',
      envelope: null,
    });
  });

  it('calls resetSession with POST /chat/sessions/{key}/reset', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ reset: true }),
    });

    await resetSession('session-a');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/sessions/session-a/reset?data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  it('calls deleteSession with DELETE /chat/sessions/{key}', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ deleted: true }),
    });

    await deleteSession('session-a');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/sessions/session-a?data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      }),
    );
  });

  it('calls pauseSession with POST /chat/agents/{agentId}/pause', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        request_id: 'control-pause-1',
        agent_id: 'main',
        status: 'accepted',
      }),
    });

    await pauseSession({ sessionKey: 'session-a', agentId: 'main' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/agents/main/pause?sessionKey=session-a&data_source=openclaw&instanceId=instance-1',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  it('pauseSession requires agentId', async () => {
    await expect(
      pauseSession({ sessionKey: 'session-a' })
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'agentId is required to pause session',
    });
  });

  it('stopFlowPlannerSession calls planner-stop endpoint with POST body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        sessionKey: 'linpo:flow:default:planner:planner-default:test',
        status: 'stopped',
        revision: 3,
        updatedAt: '2026-04-03T10:00:00Z',
      }),
    });

    const result = await stopFlowPlannerSession(
      {
        planner_session_key: 'linpo:flow:default:planner:planner-default:test',
      },
      undefined,
      BOARD_ID
    );

    expect(result).toEqual({
      session_key: 'linpo:flow:default:planner:planner-default:test',
      status: 'stopped',
      revision: 3,
      updated_at: '2026-04-03T10:00:00Z',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/boards/default/tasks/flow/planner-stop?data_source=openclaw',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plannerSessionKey: 'linpo:flow:default:planner:planner-default:test',
        }),
      }),
    );
  });

  it('probeFlowPlannerSession short-circuits empty key and encodes non-empty key', async () => {
    await expect(probeFlowPlannerSession('   ', undefined, BOARD_ID)).resolves.toEqual({ exists: false });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ exists: true }),
    });

    await probeFlowPlannerSession('linpo:flow:default:planner:planner-default:test', undefined, BOARD_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/boards/default/tasks/flow/planner-sessions/linpo%3Aflow%3Adefault%3Aplanner%3Aplanner-default%3Atest/exists?data_source=openclaw',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('maps camelCase kanban task response to existing snake_case model', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ([
        {
          id: 'task-1',
          boardId: 'default',
          title: '节点A',
          summary: '摘要',
          status: 'queued',
          source: 'flow',
          agentId: null,
          agentName: 'Agent A',
          artifacts: ['artifact.md'],
          extras: {
            requirementId: 'flow-1',
            flowNode: 'node_a',
          },
          instanceId: 'instance-1',
          createdAt: '2026-04-03T00:00:00Z',
          updatedAt: '2026-04-03T00:01:00Z',
        },
      ]),
    });

    const result = await listKanbanTasks(undefined, BOARD_ID);

    expect(result).toEqual([
      {
        id: 'task-1',
        board_id: 'default',
        title: '节点A',
        summary: '摘要',
        status: 'queued',
        source: 'flow',
        agent_id: null,
        agent_name: 'Agent A',
        artifacts: ['artifact.md'],
        extras: {
          requirement_id: 'flow-1',
          flow_node: 'node_a',
        },
        instance_id: 'instance-1',
        created_at: '2026-04-03T00:00:00Z',
        updated_at: '2026-04-03T00:01:00Z',
      },
    ]);
  });

  it('sends camelCase payload for createKanbanTask', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        id: 'task-created',
        boardId: 'default',
        title: '新任务',
        summary: '',
        status: 'queued',
        source: 'flow',
        agentId: 'agent-1',
        agentName: 'Agent 1',
        artifacts: [],
        extras: {},
        instanceId: 'instance-1',
        createdAt: '2026-04-03T00:00:00Z',
        updatedAt: '2026-04-03T00:00:00Z',
      }),
    });

    await createKanbanTask(
      {
        requirement: '实现节点',
        agent_id: 'agent-1',
        agent_name: 'Agent 1',
        instance_id: 'instance-1',
      },
      undefined,
      BOARD_ID
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/boards/default/tasks?data_source=openclaw',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirement: '实现节点',
          agentId: 'agent-1',
          agentName: 'Agent 1',
          instanceId: 'instance-1',
        }),
      }),
    );
  });

  it('throws when boardId is blank', async () => {
    await expect(listKanbanTasks(undefined, '   ')).rejects.toThrow('boardId is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
