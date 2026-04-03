import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
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
      'http://localhost:8000/api/v1/agents?data_source=openclaw&instanceId=instance-1',
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
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ts: 123, previews: [] }),
    });

    await previewSessions(['session-a', 'session-b']);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/sessions/preview?keys=session-a%2Csession-b&maxChars=2000&data_source=openclaw',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('calls session history endpoint for selected session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ts: 123, items: [] }),
    });

    await getSessionHistory('agent:main:main');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/sessions/agent%3Amain%3Amain/history?limit=200&data_source=openclaw',
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

  it('calls resetSession with POST /chat/sessions/{key}/reset', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ reset: true }),
    });

    await resetSession('session-a');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/sessions/session-a/reset?data_source=openclaw',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  it('calls deleteSession with DELETE /chat/sessions/{key}', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ deleted: true }),
    });

    await deleteSession('session-a');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/chat/sessions/session-a?data_source=openclaw',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      }),
    );
  });

  it('calls pauseSession with POST /chat/agents/{agentId}/pause', async () => {
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
      'http://localhost:8000/api/v1/chat/agents/main/pause?sessionKey=session-a&data_source=openclaw',
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
        sessionKey: 'linpo:flow:default:planner:claw3:test',
        status: 'stopped',
        revision: 3,
        updatedAt: '2026-04-03T10:00:00Z',
      }),
    });

    const result = await stopFlowPlannerSession({
      planner_session_key: 'linpo:flow:default:planner:claw3:test',
    });

    expect(result).toEqual({
      session_key: 'linpo:flow:default:planner:claw3:test',
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
          plannerSessionKey: 'linpo:flow:default:planner:claw3:test',
        }),
      }),
    );
  });

  it('probeFlowPlannerSession short-circuits empty key and encodes non-empty key', async () => {
    await expect(probeFlowPlannerSession('   ')).resolves.toEqual({ exists: false });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ exists: true }),
    });

    await probeFlowPlannerSession('linpo:flow:default:planner:claw3:test');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/boards/default/tasks/flow/planner-sessions/linpo%3Aflow%3Adefault%3Aplanner%3Aclaw3%3Atest/exists?data_source=openclaw',
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

    const result = await listKanbanTasks();

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

    await createKanbanTask({
      requirement: '实现节点',
      agent_id: 'agent-1',
      agent_name: 'Agent 1',
      instance_id: 'instance-1',
    });

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
});
