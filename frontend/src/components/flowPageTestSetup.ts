import { vi } from 'vitest';

import { applyFlowPageDefaultMocks } from './flowPageTestFixtures';
import { getFlowPageMockRegistry } from './flowPageTestMockRegistry';

export const flowPageMocks = getFlowPageMockRegistry();

export function setupFlowPageDefaultTestState(options?: { viewportWidth?: number }): void {
  vi.clearAllMocks();
  window.localStorage.clear();
  applyFlowPageDefaultMocks(flowPageMocks, options);
}
