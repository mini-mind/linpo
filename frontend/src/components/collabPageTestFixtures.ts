import type { AggregateOverviewResponse } from '../api/types';

export function buildCollabOverview(
  overrides: Partial<AggregateOverviewResponse> = {},
  options?: { requestId?: string; checkedAt?: string }
): AggregateOverviewResponse {
  return {
    request_id: options?.requestId ?? 'req-kanban',
    freshness: {
      status: 'fresh',
      checked_at: options?.checkedAt ?? '2026-03-22T12:10:00Z',
    },
    partial_failure: false,
    diagnostics: [],
    agents: [],
    stats: {
      instance_count: 0,
      agent_count: 0,
      active_agent_count: 0,
      attention_instance_count: 0,
      total_tokens: null,
    },
    token_groups: [],
    global_events: [],
    ...overrides,
  };
}

export function setTestViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}
