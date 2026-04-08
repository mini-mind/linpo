import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import './flowPageTestMockRegistry';
import { ToastProvider } from '../hooks/useToast';
import { waitForLatestMockCallFirstArg } from '../testWait';
import { FlowPage } from './FlowPage';

export function renderFlowPage(initialPath = '/flow/edit/new') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <Routes>
          <Route path="/flow/edit/:flowId" element={<FlowPage />} />
          <Route path="/flow" element={<div>flow-list</div>} />
          <Route path="/kanban" element={<div>kanban-page</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

export function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

export async function waitForFlowCanvasReady(): Promise<HTMLElement> {
  const viewport = await screen.findByTestId('flow-canvas-viewport');
  const toolbar = screen.queryByRole('toolbar', { name: '流程编辑工具栏' });
  if (toolbar) {
    throw new Error('flow toolbar should not be present in current layout');
  }
  return viewport;
}

export async function waitForPlannerFeedbackSettled(): Promise<void> {
  await waitFor(
    () => {
      const overlay = screen.queryByTestId('flow-planning-overlay');
      if (!overlay) {
        throw new Error('planning overlay is not visible');
      }
      if (overlay.style.cursor !== 'pointer') {
        throw new Error('planning overlay is still blocked');
      }
    },
    { timeout: 5_000 }
  );
}

export async function flushAsyncTasks(cycles = 3): Promise<void> {
  await act(async () => {
    for (let index = 0; index < cycles; index += 1) {
      await Promise.resolve();
    }
  });
}

export async function submitPlannerInstruction(instruction: string): Promise<void> {
  const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
  await userEvent.type(input, instruction);
  await userEvent.keyboard('{Enter}');
}

export async function waitForPlannerStopButton(): Promise<HTMLElement> {
  return await screen.findByRole('button', { name: '停止' });
}

export async function switchToFlowAndWaitCurrent(flowName: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: `切换流程-${flowName}` }));
  await screen.findByRole('button', { name: `切换流程-${flowName}`, current: 'page' });
}

export async function waitForPlanningOverlayHidden(): Promise<void> {
  await waitFor(() => {
    if (screen.queryByTestId('flow-planning-overlay')) {
      throw new Error('planning overlay is still visible');
    }
  });
}

export async function waitForPlanningOverlayVisible(): Promise<HTMLElement> {
  return await screen.findByTestId('flow-planning-overlay');
}

export { waitForLatestMockCallFirstArg };

export async function sendPlannerInstructionByButton(instruction: string): Promise<void> {
  const plannerInput = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
  await userEvent.click(plannerInput);
  await userEvent.type(plannerInput, instruction);
  await userEvent.click(await screen.findByRole('button', { name: '发送' }));
}

export async function findPlannerMessagesPanel(): Promise<HTMLElement> {
  return await screen.findByTestId('flow-planner-messages');
}

export async function waitForPlannerMessageInPanel(message: string): Promise<void> {
  const panel = await findPlannerMessagesPanel();
  await within(panel).findByText(message);
}

export async function waitForPlannerMessageNotInPanel(message: string): Promise<void> {
  await waitFor(() => {
    const panel = screen.queryByTestId('flow-planner-messages');
    if (!panel) {
      throw new Error('planner messages panel is not rendered');
    }
    if (within(panel).queryByText(message)) {
      throw new Error(`planner message still exists: ${message}`);
    }
  });
}
