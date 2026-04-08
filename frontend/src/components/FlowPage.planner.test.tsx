import '@testing-library/jest-dom';
import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowGenerateResponse } from '../api/types';
import * as toastHooks from '../hooks/useToast';
import {
  renderFlowPage,
  submitPlannerInstruction,
  waitForFlowCanvasReady,
  waitForPlannerStopButton,
} from './flowPageTestHarness';
import { buildGenerateResponse, seedFlowDraftRecord } from './flowPageTestFixtures';
import { flowPageMocks, setupFlowPageDefaultTestState } from './flowPageTestSetup';

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

function seedDraftFlow(id = 'draft-editable'): string {
  return seedFlowDraftRecord(id);
}

async function clickPlannerStopAndWait(expectedStopCallCount: number): Promise<void> {
  await userEvent.click(await waitForPlannerStopButton());
  await waitFor(() => {
    expect(mockStopFlowPlannerSession).toHaveBeenCalledTimes(expectedStopCallCount);
  });
}

describe('FlowPage planner', () => {
  beforeEach(() => {
    setupFlowPageDefaultTestState({ viewportWidth: 1280 });
  });

  it('switches send button to stop and calls planner stop api while planning', async () => {
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          window.setTimeout(() => resolve(buildGenerateResponse()), 0);
        })
    );

    const flowId = seedDraftFlow('draft-planner-stop');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await submitPlannerInstruction('请先规划一个流程');
    await waitForPlannerStopButton();
    await userEvent.click(screen.getByTestId('flow-planning-overlay'));
    expect(screen.getByTestId('flow-planner-messages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();

    await clickPlannerStopAndWait(1);
    expect(mockStopFlowPlannerSession).toHaveBeenCalledWith(
      { planner_session_key: expect.stringContaining('linpo:flow:default:planner:claw3:') },
      undefined,
      'default'
    );
    expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('flow-planner-input'));
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  it('restores planner ui for retry after generate rejects', async () => {
    let rejectFirstGenerate: ((reason?: unknown) => void) | null = null;
    mockGenerateFlowFromRequirement
      .mockImplementationOnce(
        () =>
          new Promise<FlowGenerateResponse>((_resolve, reject) => {
            rejectFirstGenerate = reject;
          })
      )
      .mockResolvedValueOnce(
        buildGenerateResponse({
          planner_session_key: 'linpo:flow:default:planner:claw3:retry-success',
        })
      );

    const addToast = vi.fn();
    const useToastSpy = vi.spyOn(toastHooks, 'useToast').mockReturnValue({
      toasts: [],
      addToast,
      removeToast: vi.fn(),
    });

    try {
      const flowId = seedDraftFlow('draft-planner-retry-after-error');
      renderFlowPage(`/flow/edit/${flowId}`);
      await waitForFlowCanvasReady();

      await submitPlannerInstruction('第一次发送触发失败');

      await waitFor(() => {
        expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();

      if (!rejectFirstGenerate) {
        throw new Error('first generate rejecter missing');
      }
      await act(async () => {
        rejectFirstGenerate?.(new Error('planner exploded'));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
      expect(addToast).toHaveBeenCalledWith('planner exploded', 'error');

      const retryInput = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
      await userEvent.type(retryInput, '第二次发送重试');
      await userEvent.click(screen.getByRole('button', { name: '发送' }));

      await waitFor(() => {
        expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(2);
      });
      expect(mockGenerateFlowFromRequirement.mock.calls[1]?.[0]?.requirement).toBe('第二次发送重试');
    } finally {
      useToastSpy.mockRestore();
    }
  });
});
