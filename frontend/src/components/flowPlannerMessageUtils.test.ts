import { describe, expect, it } from 'vitest';

import type { FlowChatMessageItem } from '../api/types';
import {
  PLANNER_STATUS_PLANNING_TEXT,
  PLANNER_STATUS_STOPPED_TEXT,
  hasPendingPlannerReply,
  sanitizePlannerMessages,
} from './flowPlannerMessageUtils';

function makeMessage(overrides: Partial<FlowChatMessageItem> & { role: FlowChatMessageItem['role'] }): FlowChatMessageItem {
  return {
    role: overrides.role,
    content: String(overrides.content ?? ''),
    created_at: String(overrides.created_at ?? ''),
  };
}

describe('flowPlannerMessageUtils', () => {
  it('normalizes legacy planner status messages into system status labels', () => {
    const messages = sanitizePlannerMessages([
      makeMessage({ role: 'assistant', content: '已发送规划请求，等待 claw3 逐节点编辑工作流。' }),
      makeMessage({ role: 'assistant', content: '规划中' }),
      makeMessage({ role: 'assistant', content: '已停止当前规划会话。' }),
    ]);

    expect(messages).toEqual([
      makeMessage({ role: 'system', content: PLANNER_STATUS_PLANNING_TEXT }),
      makeMessage({ role: 'system', content: PLANNER_STATUS_PLANNING_TEXT }),
      makeMessage({ role: 'system', content: PLANNER_STATUS_STOPPED_TEXT }),
    ]);
  });

  it('normalizes planner http call messages into concise node edit entries', () => {
    const withNodeId = sanitizePlannerMessages([
      makeMessage({ role: 'assistant', content: 'curl -X POST https://x/api {"node_id":"node_2"}' }),
    ]);
    expect(withNodeId[0]).toEqual(makeMessage({ role: 'system', content: '🧩 编辑了node_2' }));

    const withoutNodeId = sanitizePlannerMessages([
      makeMessage({ role: 'assistant', content: 'curl -X POST https://x/api/v1/patch payload contains node-meta' }),
    ]);
    expect(withoutNodeId[0]).toEqual(makeMessage({ role: 'system', content: '🧩 编辑了节点' }));
  });

  it('detects pending reply by skipping trailing planner status system messages', () => {
    expect(
      hasPendingPlannerReply([
        makeMessage({ role: 'user', content: '继续补全流程' }),
        makeMessage({ role: 'system', content: PLANNER_STATUS_PLANNING_TEXT }),
      ])
    ).toBe(true);

    expect(
      hasPendingPlannerReply([
        makeMessage({ role: 'user', content: '继续补全流程' }),
        makeMessage({ role: 'assistant', content: '已补全' }),
        makeMessage({ role: 'system', content: PLANNER_STATUS_STOPPED_TEXT }),
      ])
    ).toBe(false);
  });
});
