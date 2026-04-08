import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FlowGenerateResponse } from '../api/types';
import {
  flushAsyncTasks,
  renderFlowPage,
  submitPlannerInstruction,
  switchToFlowAndWaitCurrent,
  waitForFlowCanvasReady,
  waitForPlanningOverlayHidden,
  waitForPlanningOverlayVisible,
} from './flowPageTestHarness';
import { buildGenerateResponse, seedFlowDraftRecord } from './flowPageTestFixtures';
import { flowPageMocks, setupFlowPageDefaultTestState } from './flowPageTestSetup';
import { upsertFlowDraft } from './flowDraftStore';

const {
  mockGetAggregateOverview,
  mockGenerateFlowFromRequirement,
  mockConfirmFlowToKanban,
  mockStopFlowPlannerSession,
  mockDeleteKanbanRequirementTasks,
  mockDeleteFlowDraftRecord,
  mockListKanbanTasks,
  mockListFlowDraftRecords,
  mockProbeFlowPlannerSession,
  mockRenameFlowRequirement,
  mockStopFlowRequirement,
  mockContinueFlowRequirement,
  mockSyncFlowRequirement,
  mockUpsertFlowDraftRecord,
  mockCreateBoardTasksSseClient,
  mockCreateFlowPlannerSseClient,
} = flowPageMocks;

function seedDraftFlow(id: string, name: string): void {
  seedFlowDraftRecord(id, { name });
}

describe('FlowPage switching', () => {
  beforeEach(() => {
    setupFlowPageDefaultTestState({ viewportWidth: 1280 });
  });

  it('does not leak a stale planner session into another flow after switching', async () => {
    const resolveFirstGenerateRef: { current: ((value: FlowGenerateResponse) => void) | null } = { current: null };
    mockGenerateFlowFromRequirement
      .mockImplementationOnce(
        () =>
          new Promise<FlowGenerateResponse>((resolve) => {
            resolveFirstGenerateRef.current = resolve;
          })
      )
      .mockResolvedValueOnce(
        buildGenerateResponse({
          planner_session_key: 'linpo:flow:default:planner:planner:flow-b',
        })
      );

    seedDraftFlow('draft-flow-a', '流程A草稿');
    seedDraftFlow('draft-flow-b', '流程B草稿');

    renderFlowPage('/flow/edit/draft-flow-a');
    await waitForFlowCanvasReady();

    await submitPlannerInstruction('流程A的规划需求');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('流程A的规划需求')).toBeInTheDocument();
    await waitForPlanningOverlayVisible();

    await switchToFlowAndWaitCurrent('流程B草稿');
    expect(screen.queryByText('流程A的规划需求')).not.toBeInTheDocument();
    await waitForPlanningOverlayHidden();

    const resolveFirstGenerateFn = resolveFirstGenerateRef.current;
    if (!resolveFirstGenerateFn) {
      throw new Error('first planner resolver missing');
    }
    resolveFirstGenerateFn(
      buildGenerateResponse({
        planner_session_key: 'linpo:flow:default:planner:planner:stale-flow-a',
      })
    );

    await flushAsyncTasks();

    await submitPlannerInstruction('流程B的规划需求');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(2);
    });
    const secondPayload = mockGenerateFlowFromRequirement.mock.calls[1][0];
    expect(secondPayload.planner_session_key).not.toBe('linpo:flow:default:planner:planner:stale-flow-a');
    expect(secondPayload.requirement).toBe('流程B的规划需求');
  });

  it('recomputes planning overlay after switching away and back while waiting for reply', async () => {
    const resolveFirstGenerateRef: { current: ((value: FlowGenerateResponse) => void) | null } = { current: null };
    mockGenerateFlowFromRequirement.mockImplementationOnce(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveFirstGenerateRef.current = resolve;
        })
    );

    upsertFlowDraft({
      id: 'draft-overlay-a',
      name: '遮罩流程A',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: 'linpo:flow:default:planner:planner:overlay-a',
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });
    upsertFlowDraft({
      id: 'draft-overlay-b',
      name: '遮罩流程B',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: 'linpo:flow:default:planner:planner:overlay-b',
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T08:01:00Z',
      updated_at: '2026-03-29T08:01:00Z',
    });

    renderFlowPage('/flow/edit/draft-overlay-a');
    await waitForFlowCanvasReady();

    await submitPlannerInstruction('流程A等待回复中');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();

    await switchToFlowAndWaitCurrent('遮罩流程B');
    await waitForPlanningOverlayHidden();

    await switchToFlowAndWaitCurrent('遮罩流程A');
    await waitForPlanningOverlayVisible();

    await userEvent.click(await waitForPlanningOverlayVisible());
    await waitForPlanningOverlayVisible();

    const resolveFirstGenerateFn = resolveFirstGenerateRef.current;
    if (!resolveFirstGenerateFn) {
      throw new Error('first planner resolver missing');
    }
    resolveFirstGenerateFn(
      buildGenerateResponse({
        planner_session_key: 'linpo:flow:default:planner:planner:overlay-a',
      })
    );

    await flushAsyncTasks();
  });
});
