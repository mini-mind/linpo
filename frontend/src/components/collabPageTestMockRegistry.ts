import { vi } from 'vitest';

const collabPageMockRegistry = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockListInstances: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockCreateKanbanTask: vi.fn(),
  mockConfirmFlowToKanban: vi.fn(),
  mockContinueFlowRequirement: vi.fn(),
  mockDeleteKanbanTask: vi.fn(),
  mockContinueKanbanTask: vi.fn(),
  mockInterruptKanbanTask: vi.fn(),
  mockStopFlowRequirement: vi.fn(),
  mockGetSessionHistory: vi.fn(),
  mockCreateBoardTasksSseClient: vi.fn(),
  mockCreateObserverRealtimeClient: vi.fn(),
  mockPreviewKanbanTaskOutput: vi.fn(),
}));

export function getCollabPageMockRegistry() {
  return collabPageMockRegistry;
}

vi.mock('../api/instanceClient', async () => {
  const actual = await vi.importActual<typeof import('../api/instanceClient')>('../api/instanceClient');
  return {
    ...actual,
    listInstances: collabPageMockRegistry.mockListInstances,
  };
});

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: collabPageMockRegistry.mockGetAggregateOverview,
    listKanbanTasks: collabPageMockRegistry.mockListKanbanTasks,
    createKanbanTask: collabPageMockRegistry.mockCreateKanbanTask,
    confirmFlowToKanban: collabPageMockRegistry.mockConfirmFlowToKanban,
    continueFlowRequirement: collabPageMockRegistry.mockContinueFlowRequirement,
    deleteKanbanTask: collabPageMockRegistry.mockDeleteKanbanTask,
    continueKanbanTask: collabPageMockRegistry.mockContinueKanbanTask,
    interruptKanbanTask: collabPageMockRegistry.mockInterruptKanbanTask,
    stopFlowRequirement: collabPageMockRegistry.mockStopFlowRequirement,
    getSessionHistory: collabPageMockRegistry.mockGetSessionHistory,
    previewKanbanTaskOutput: collabPageMockRegistry.mockPreviewKanbanTaskOutput,
  };
});

vi.mock('../api/realtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../api/realtimeClient')>('../api/realtimeClient');
  return {
    ...actual,
    createBoardTasksSseClient: collabPageMockRegistry.mockCreateBoardTasksSseClient,
    createObserverRealtimeClient: collabPageMockRegistry.mockCreateObserverRealtimeClient,
  };
});
