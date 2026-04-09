import { vi } from 'vitest';

const flowPageMockRegistry = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockGenerateFlowFromRequirement: vi.fn(),
  mockConfirmFlowToKanban: vi.fn(),
  mockStopFlowPlannerSession: vi.fn(),
  mockDeleteKanbanRequirementTasks: vi.fn(),
  mockDeleteFlowDraftRecord: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockListFlowDraftRecords: vi.fn(),
  mockProbeFlowPlannerSession: vi.fn(),
  mockRenameFlowRequirement: vi.fn(),
  mockStopFlowRequirement: vi.fn(),
  mockContinueFlowRequirement: vi.fn(),
  mockSyncFlowRequirement: vi.fn(),
  mockUpsertFlowDraftRecord: vi.fn(),
  mockCreateBoardTasksSseClient: vi.fn(),
  mockCreateFlowPlannerSseClient: vi.fn(),
  mockGetInstancePlannerAgentPreference: vi.fn(),
  mockUpdateInstancePlannerAgentPreference: vi.fn(),
}));

export function getFlowPageMockRegistry() {
  return flowPageMockRegistry;
}

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: flowPageMockRegistry.mockGetAggregateOverview,
    generateFlowFromRequirement: flowPageMockRegistry.mockGenerateFlowFromRequirement,
    confirmFlowToKanban: flowPageMockRegistry.mockConfirmFlowToKanban,
    stopFlowPlannerSession: flowPageMockRegistry.mockStopFlowPlannerSession,
    deleteKanbanRequirementTasks: flowPageMockRegistry.mockDeleteKanbanRequirementTasks,
    deleteFlowDraftRecord: flowPageMockRegistry.mockDeleteFlowDraftRecord,
    listKanbanTasks: flowPageMockRegistry.mockListKanbanTasks,
    listFlowDraftRecords: flowPageMockRegistry.mockListFlowDraftRecords,
    probeFlowPlannerSession: flowPageMockRegistry.mockProbeFlowPlannerSession,
    renameFlowRequirement: flowPageMockRegistry.mockRenameFlowRequirement,
    stopFlowRequirement: flowPageMockRegistry.mockStopFlowRequirement,
    continueFlowRequirement: flowPageMockRegistry.mockContinueFlowRequirement,
    syncFlowRequirement: flowPageMockRegistry.mockSyncFlowRequirement,
    upsertFlowDraftRecord: flowPageMockRegistry.mockUpsertFlowDraftRecord,
  };
});

vi.mock('../api/realtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../api/realtimeClient')>('../api/realtimeClient');
  return {
    ...actual,
    createBoardTasksSseClient: flowPageMockRegistry.mockCreateBoardTasksSseClient,
    createFlowPlannerSseClient: flowPageMockRegistry.mockCreateFlowPlannerSseClient,
  };
});

vi.mock('../api/instanceClient', async () => {
  const actual = await vi.importActual<typeof import('../api/instanceClient')>('../api/instanceClient');
  return {
    ...actual,
    getInstancePlannerAgentPreference: flowPageMockRegistry.mockGetInstancePlannerAgentPreference,
    updateInstancePlannerAgentPreference: flowPageMockRegistry.mockUpdateInstancePlannerAgentPreference,
  };
});
