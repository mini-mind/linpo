import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearFlowDrafts,
  deleteFlowDraft,
  getFlowDraftById,
  listFlowDrafts,
  upsertFlowDraft,
} from './flowDraftStore';

describe('flowDraftStore', () => {
  beforeEach(() => {
    clearFlowDrafts();
    window.localStorage.clear();
  });

  it('falls back missing or invalid timestamps to epoch and does not make legacy drafts look newer', () => {
    upsertFlowDraft({
      id: 'legacy-missing-ts',
      name: '历史草稿-缺失时间',
    } as never);
    upsertFlowDraft({
      id: 'legacy-invalid-ts',
      name: '历史草稿-异常时间',
      created_at: 'not-a-date',
      updated_at: 'still-not-a-date',
    } as never);
    upsertFlowDraft({
      id: 'normal-old-ts',
      name: '正常旧草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2024-01-10T00:00:00.000Z',
      updated_at: '2024-01-10T10:00:00.000Z',
    });

    const drafts = listFlowDrafts();
    expect(drafts[0]?.id).toBe('normal-old-ts');

    expect(getFlowDraftById('legacy-missing-ts')?.created_at).toBe('1970-01-01T00:00:00.000Z');
    expect(getFlowDraftById('legacy-missing-ts')?.updated_at).toBe('1970-01-01T00:00:00.000Z');
    expect(getFlowDraftById('legacy-invalid-ts')?.created_at).toBe('1970-01-01T00:00:00.000Z');
    expect(getFlowDraftById('legacy-invalid-ts')?.updated_at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('keeps provided updated_at when upserting an existing draft', () => {
    upsertFlowDraft({
      id: 'draft-older',
      name: '较早草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-03-29T06:00:00Z',
      updated_at: '2026-03-29T06:30:00Z',
    });
    upsertFlowDraft({
      id: 'draft-recent',
      name: '最近草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:30:00Z',
    });

    upsertFlowDraft({
      id: 'draft-older',
      name: '较早草稿-改名',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 1,
      created_at: '2026-03-29T06:00:00Z',
      updated_at: '2026-03-29T06:30:00Z',
    });

    const drafts = listFlowDrafts();
    expect(drafts[0]?.id).toBe('draft-recent');
    expect(drafts[1]?.id).toBe('draft-older');
    expect(getFlowDraftById('draft-older')?.updated_at).toBe('2026-03-29T06:30:00Z');
    expect(getFlowDraftById('draft-older')?.revision).toBe(1);
  });

  it('normalizes missing revision to zero for legacy drafts and persists newer revision', () => {
    upsertFlowDraft({
      id: 'legacy-no-revision',
      name: '历史草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    } as never);

    expect(getFlowDraftById('legacy-no-revision')?.revision).toBe(0);

    upsertFlowDraft({
      id: 'legacy-no-revision',
      name: '历史草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 5,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:10:00Z',
    });

    expect(getFlowDraftById('legacy-no-revision')?.revision).toBe(5);
  });

  it('does not persist drafts to localStorage', () => {
    upsertFlowDraft({
      id: 'draft-local-persist',
      name: '本地持久草稿',
      requirement: 'need local persistence',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 2,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:10:00Z',
    });

    expect(window.localStorage.getItem('linpo_flow_drafts_v1')).toBeNull();
    expect(getFlowDraftById('draft-local-persist')?.revision).toBe(2);
  });

  it('preserves structured planner message kind and payload in draft snapshots', () => {
    upsertFlowDraft({
      id: 'draft-structured-message',
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

    const firstMessage = getFlowDraftById('draft-structured-message')?.planner_messages?.[0];
    expect(firstMessage?.kind).toBe('tool_call_start');
    expect(firstMessage?.payload).toEqual({ tool_name: 'patch_flow_node', run_id: 'run-1' });
  });

  it('deleting and clearing drafts only affect in-memory records', () => {
    upsertFlowDraft({
      id: 'draft-local-delete',
      name: '删除草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });

    deleteFlowDraft('draft-local-delete');
    expect(listFlowDrafts()).toEqual([]);

    upsertFlowDraft({
      id: 'draft-local-clear',
      name: '清空草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });
    clearFlowDrafts();
    expect(listFlowDrafts()).toEqual([]);
  });

  it('ignores legacy localStorage drafts payload', () => {
    window.localStorage.setItem('linpo_flow_drafts_v1', JSON.stringify([
      {
        id: 'legacy-local-storage-draft',
        name: '历史本地草稿',
        requirement: 'legacy',
        nodes: [],
        edges: [],
        lanes: [],
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: null,
        revision: 1,
        created_at: '2026-03-29T08:00:00Z',
        updated_at: '2026-03-29T08:10:00Z',
      },
    ]));
    const drafts = listFlowDrafts();
    expect(drafts).toEqual([]);
    expect(window.localStorage.getItem('linpo_flow_drafts_v1')).not.toBeNull();
  });
});
