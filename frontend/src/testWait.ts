import { waitFor } from '@testing-library/react';

export const TEST_WAIT_TIMEOUT_MS = 2500;

type MockWithCalls = {
  mock: {
    calls: unknown[][];
  };
};

export async function waitForLatestMockCallFirstArg(
  mockFn: MockWithCalls,
  minimumCalls = 1
): Promise<unknown> {
  await waitFor(
    () => {
      if (mockFn.mock.calls.length < minimumCalls) {
        throw new Error(`mock call count not reached: ${mockFn.mock.calls.length}/${minimumCalls}`);
      }
    },
    { timeout: TEST_WAIT_TIMEOUT_MS }
  );
  return mockFn.mock.calls[mockFn.mock.calls.length - 1]?.[0];
}
