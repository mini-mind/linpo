import { describe, expect, it } from 'vitest';

import type { FlowChatMessageItem } from '../api/types';
import {
  hasPendingPlannerReply,
  mergeFlowChatMessagesFromRealtime,
  normalizePlannerObserverMessageKind,
  normalizePlannerObserverMessageRole,
  resolvePlannerMessageRealtimeUpdate,
  resolvePlannerMessageRealtimeWriteIntent,
  sanitizePlannerMessages,
} from './flowPlannerMessageUtils';

function makeMessage(overrides: Partial<FlowChatMessageItem> & { role: FlowChatMessageItem['role'] }): FlowChatMessageItem {
  return {
    role: overrides.role,
    content: String(overrides.content ?? ''),
    created_at: String(overrides.created_at ?? ''),
    ...(overrides.kind ? { kind: overrides.kind } : {}),
    ...(overrides.payload ? { payload: overrides.payload } : {}),
  };
}

describe('flowPlannerMessageUtils', () => {
  it('keeps event stream text as-is without legacy placeholder inference', () => {
    const messages = sanitizePlannerMessages([
      makeMessage({ role: 'assistant', content: '已发送规划请求，等待 planner 逐节点编辑工作流。' }),
      makeMessage({ role: 'assistant', content: 'curl -X POST https://x/api {"node_id":"node_2"}' }),
    ]);

    expect(messages[0]?.content).toBe('已发送规划请求，等待 planner 逐节点编辑工作流。');
    expect(messages[1]?.content).toContain('curl -X POST');
  });

  it('preserves structured kind/payload fields', () => {
    const messages = sanitizePlannerMessages([
      makeMessage({
        role: 'system',
        content: '',
        kind: 'tool_call_start',
        payload: { tool_name: 'patch_flow_node' },
      }),
    ]);

    expect(messages[0]).toMatchObject({
      role: 'system',
      kind: 'tool_call_start',
      payload: { tool_name: 'patch_flow_node' },
      content: '',
    });
  });

  it('keeps empty assistant_delta for realtime placeholder rendering', () => {
    const messages = sanitizePlannerMessages([
      makeMessage({
        role: 'assistant',
        content: '',
        kind: 'assistant_delta',
        created_at: '2026-04-11T00:00:00Z',
      }),
    ]);

    expect(messages).toEqual([
      makeMessage({
        role: 'assistant',
        content: '',
        kind: 'assistant_delta',
        created_at: '2026-04-11T00:00:00Z',
      }),
    ]);
  });

  it('detects pending reply by latest message role', () => {
    expect(hasPendingPlannerReply([makeMessage({ role: 'user', content: '继续补全流程' })])).toBe(true);
    expect(
      hasPendingPlannerReply([
        makeMessage({ role: 'user', content: '继续补全流程' }),
        makeMessage({ role: 'assistant', content: '已补全' }),
      ])
    ).toBe(false);
  });

  it('merges append_chunk assistant content incrementally', () => {
    const previous = [
      makeMessage({ role: 'user', content: '拆解这个需求' }),
      makeMessage({ role: 'assistant', content: '第一段' }),
    ];
    const incoming = [
      makeMessage({ role: 'assistant', content: '第一段 第二段' }),
    ];
    expect(
      mergeFlowChatMessagesFromRealtime({
        previousMessages: previous,
        incomingMessages: incoming,
        updateMode: 'append_chunk',
      })
    ).toEqual([
      makeMessage({ role: 'user', content: '拆解这个需求' }),
      makeMessage({ role: 'assistant', content: '第一段 第二段' }),
    ]);
  });

  it('keeps local pending user message when realtime replace arrives empty', () => {
    const previous = [
      makeMessage({ role: 'user', content: '继续拆解', created_at: '2026-04-11T11:00:00Z' }),
    ];
    expect(
      mergeFlowChatMessagesFromRealtime({
        previousMessages: previous,
        incomingMessages: [],
        updateMode: 'replace',
      })
    ).toEqual(previous);
  });

  it('accepts strictly increasing seq in single-source write intent', () => {
    const first = resolvePlannerMessageRealtimeWriteIntent({
      currentState: undefined,
      seq: 10,
    });
    expect(first.kind).toBe('apply');

    const stale = resolvePlannerMessageRealtimeWriteIntent({
      currentState: first.nextState,
      seq: 9,
    });
    expect(stale.kind).toBe('ignore');

    const next = resolvePlannerMessageRealtimeWriteIntent({
      currentState: first.nextState,
      seq: 11,
    });
    expect(next.kind).toBe('apply');
  });

  it('resolves realtime update by ignoring stale seq and keeping previous messages', () => {
    const previousMessages = [makeMessage({ role: 'assistant', content: '第一段' })];
    const first = resolvePlannerMessageRealtimeUpdate({
      currentState: undefined,
      previousMessages,
      incomingMessages: [makeMessage({ role: 'assistant', content: '第一段 第二段' })],
      seq: 7,
      updateMode: 'append_chunk',
    });
    expect(first.applyResult.kind).toBe('applied');

    const stale = resolvePlannerMessageRealtimeUpdate({
      currentState: first.nextState,
      previousMessages: first.nextMessages,
      incomingMessages: [makeMessage({ role: 'assistant', content: '旧包' })],
      seq: 7,
      updateMode: 'append_chunk',
    });
    expect(stale.applyResult.kind).toBe('ignored');
    expect(stale.nextMessages).toEqual(first.nextMessages);
  });

  it('normalizes observer role/kind helpers for backward parser compatibility', () => {
    expect(normalizePlannerObserverMessageRole('user')).toBe('user');
    expect(normalizePlannerObserverMessageRole('assistant')).toBe('assistant');
    expect(normalizePlannerObserverMessageRole('tool')).toBe('system');
    expect(normalizePlannerObserverMessageKind({ role: 'tool' })).toBe('tool_call');
    expect(normalizePlannerObserverMessageKind({ role: 'tool', kind: 'tool_call_end' })).toBe('tool_call_end');
  });
});
