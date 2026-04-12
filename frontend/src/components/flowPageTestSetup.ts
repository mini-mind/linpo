import { vi } from 'vitest';

import { applyFlowPageDefaultMocks } from './flowPageTestFixtures';
import { clearFlowDrafts } from './flowDraftStore';
import { clearFlowSidebarOrder } from './flowSidebarOrderStore';
import { getFlowPageMockRegistry } from './flowPageTestMockRegistry';

export const flowPageMocks = getFlowPageMockRegistry();

export function setupFlowPageDefaultTestState(options?: { viewportWidth?: number }): void {
  vi.clearAllMocks();
  clearFlowDrafts();
  clearFlowSidebarOrder();
  window.localStorage.clear();
  applyFlowPageDefaultMocks(flowPageMocks, options);
}
