import { describe, expect, it } from 'vitest';

import {
  decodeFlowChatMessageItem,
  decodeFlowDraftItem,
  encodeFlowDraftUpsertRequest,
} from './taskFlowContract';

describe('taskFlowContract flow chat message compatibility', () => {
  it('keeps kind and payload when encoding planner_messages', () => {
    const encoded = encodeFlowDraftUpsertRequest({
      id: 'draft-structured',
      name: '结构化消息草稿',
      requirement: '',
      nodes: [],
      edges: [],
      planner_messages: [
        {
          role: 'system',
          content: '',
          kind: 'tool_call_start',
          payload: { tool_name: 'patch_flow_node', run_id: 'run-1' },
          created_at: '2026-04-11T10:00:00Z',
        },
      ],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-04-11T10:00:00Z',
      updated_at: '2026-04-11T10:00:00Z',
    });

    const firstMessage = Array.isArray(encoded.plannerMessages)
      ? (encoded.plannerMessages[0] as Record<string, unknown>)
      : null;
    expect(firstMessage).not.toBeNull();
    expect(firstMessage?.kind).toBe('tool_call_start');
    expect(firstMessage?.payload).toEqual({ tool_name: 'patch_flow_node', run_id: 'run-1' });
  });

  it('decodes legacy flow chat message without kind/payload', () => {
    const decoded = decodeFlowChatMessageItem({
      role: 'assistant',
      content: '旧格式消息',
      created_at: '2026-04-11T10:00:00Z',
    });

    expect(decoded).toEqual({
      role: 'assistant',
      content: '旧格式消息',
      created_at: '2026-04-11T10:00:00Z',
    });
  });

  it('decodes tool role message as system and keeps structured payload', () => {
    const decoded = decodeFlowChatMessageItem({
      role: 'tool',
      content: '',
      kind: 'tool_call_start',
      payload: { tool_name: 'patch_flow_node' },
      created_at: '2026-04-11T10:00:00Z',
    });

    expect(decoded).toEqual({
      role: 'system',
      content: '',
      kind: 'tool_call_start',
      payload: { tool_name: 'patch_flow_node' },
      created_at: '2026-04-11T10:00:00Z',
    });
  });

  it('decodes structured planner_messages from draft payload', () => {
    const decodedDraft = decodeFlowDraftItem({
      id: 'draft-structured',
      name: '结构化草稿',
      requirement: '',
      nodes: [],
      edges: [],
      planner_messages: [
        {
          role: 'system',
          content: '',
          kind: 'tool_call_end',
          payload: { tool_name: 'patch_flow_node', status: 'ok' },
          created_at: '2026-04-11T10:00:01Z',
        },
      ],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      planner_runtime: {
        planner_session_status: 'idle',
        is_planning: false,
        is_planner_stopping: false,
        is_overlay_close_blocked: false,
      },
      revision: 0,
      created_at: '2026-04-11T10:00:00Z',
      updated_at: '2026-04-11T10:00:00Z',
    });

    expect(decodedDraft?.planner_messages[0]).toEqual({
      role: 'system',
      content: '',
      kind: 'tool_call_end',
      payload: { tool_name: 'patch_flow_node', status: 'ok' },
      created_at: '2026-04-11T10:00:01Z',
    });
  });
});
