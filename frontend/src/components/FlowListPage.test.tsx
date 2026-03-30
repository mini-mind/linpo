import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateOverviewResponse, KanbanTaskItem } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import { upsertFlowDraft } from './flowDraftStore';
import { FlowListPage } from './FlowListPage';

const {
  mockDeleteKanbanRequirementTasks,
  mockGenerateFlowFromRequirement,
  mockGetAggregateOverview,
  mockListKanbanTasks,
  mockRenameFlowRequirement,
} = vi.hoisted(() => ({
  mockDeleteKanbanRequirementTasks: vi.fn(),
  mockGenerateFlowFromRequirement: vi.fn(),
  mockGetAggregateOverview: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockRenameFlowRequirement: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    deleteKanbanRequirementTasks: mockDeleteKanbanRequirementTasks,
    generateFlowFromRequirement: mockGenerateFlowFromRequirement,
    getAggregateOverview: mockGetAggregateOverview,
    listKanbanTasks: mockListKanbanTasks,
    renameFlowRequirement: mockRenameFlowRequirement,
  };
});

function buildOverview(): AggregateOverviewResponse {
  return {
    request_id: 'req-flow-list-overview',
    freshness: {
      status: 'fresh',
      checked_at: '2026-03-29T10:00:00Z',
    },
    partial_failure: false,
    diagnostics: [],
    agents: [
      {
        instance_id: 'instance-alpha',
        instance_name: 'alpha-instance',
        agent_id: 'agent-alpha',
        agent_name: 'Alpha Agent',
        status: 'running',
        is_active: true,
        last_active_at: '2026-03-29T10:00:00Z',
        drilldown_path: '/session/agent-alpha/__none__/__new__?instanceId=instance-alpha',
      },
    ],
    stats: {
      instance_count: 1,
      agent_count: 1,
      active_agent_count: 1,
      attention_instance_count: 0,
      total_tokens: null,
    },
    token_groups: [],
    global_events: [],
  };
}

function buildTask(overrides: Partial<KanbanTaskItem> = {}): KanbanTaskItem {
  return {
    id: 'task-flow-a',
    board_id: 'default',
    title: '流程A默认标题',
    summary: 'summary',
    status: 'queued',
    source: 'flow',
    agent_id: 'agent-alpha',
    agent_name: 'Alpha Agent',
    artifacts: [],
    extras: {
      requirement_id: 'req-flow-a',
      requirement_title: '流程A',
      flow_node: 'node-1',
      dependencies: 'none',
      sensitive: 'false',
    },
    instance_id: 'instance-alpha',
    created_at: '2026-03-29T10:00:00Z',
    updated_at: '2026-03-29T10:05:00Z',
    ...overrides,
  };
}

function renderFlowListPage(): void {
  render(
    <MemoryRouter initialEntries={['/flow']}>
      <ToastProvider>
        <Routes>
          <Route path="/flow" element={<FlowListPage />} />
          <Route path="/flow/edit/:flowId" element={<div>flow-editor-route</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('FlowListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockGetAggregateOverview.mockResolvedValue(buildOverview());
    mockListKanbanTasks.mockResolvedValue([buildTask()]);
    mockGenerateFlowFromRequirement.mockResolvedValue({
      board_id: 'default',
      planner_session_key: 'linpo:planner:test',
      manager_session_key: 'linpo:manager:test',
      execution_session_prefix: 'linpo:exec:test',
      nodes: [],
      edges: [],
      messages: [],
      created_task_ids: [],
    });
    mockRenameFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow-a',
      requirement_title: '新流程A',
      updated_task_ids: ['task-flow-a'],
    });
    mockDeleteKanbanRequirementTasks.mockResolvedValue({
      deleted: true,
      deleted_task_ids: ['task-flow-a'],
      requirement_id: 'req-flow-a',
    });
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  it('renders toolbar controls and hides extra title/description block', async () => {
    renderFlowListPage();

    await screen.findByRole('toolbar', { name: '流程列表工具栏' });

    expect(screen.getByLabelText('流程筛选')).toBeInTheDocument();
    expect(screen.getByLabelText('来源筛选')).toBeInTheDocument();
    expect(screen.getByLabelText('流程排序')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建流程' })).toBeInTheDocument();
    expect(screen.queryByLabelText('委派 Agent（用于拆解）')).not.toBeInTheDocument();
    expect(screen.queryByText('流程用于需求拆解与编排，提交流程后在看板查看执行进度。')).not.toBeInTheDocument();
  });

  it('supports source filter and flow sort in toolbar', async () => {
    upsertFlowDraft({
      id: 'draft-only',
      name: '草稿流程X',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T09:00:00Z',
      updated_at: '2026-03-29T09:00:00Z',
    });
    renderFlowListPage();
    await screen.findByRole('button', { name: '编辑流程-流程A' });

    await userEvent.selectOptions(screen.getByLabelText('来源筛选'), 'draft');
    expect(screen.getByRole('button', { name: '编辑流程-草稿流程X' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑流程-流程A' })).not.toBeInTheDocument();
  });

  it('opens flow editor when clicking card body', async () => {
    renderFlowListPage();

    await userEvent.click(await screen.findByRole('button', { name: '打开流程-流程A' }));
    await waitFor(() => {
      expect(screen.getByText('flow-editor-route')).toBeInTheDocument();
    });
  });

  it('supports card edit actions: rename and delete flow', async () => {
    renderFlowListPage();
    const editButton = await screen.findByRole('button', { name: '编辑流程-流程A' });
    await userEvent.click(editButton);

    await screen.findByRole('dialog', { name: '编辑流程' });
    await userEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await waitFor(() => {
      expect(mockRenameFlowRequirement).toHaveBeenCalledWith('req-flow-a', { name: '流程A' }, undefined, 'default');
    });

    await userEvent.click(screen.getByRole('button', { name: '删除流程' }));
    await waitFor(() => {
      expect(mockDeleteKanbanRequirementTasks).toHaveBeenCalledWith('req-flow-a', undefined, 'default');
    });

    const nextEditButton = await screen.findByRole('button', { name: '编辑流程-流程A' });
    await userEvent.click(nextEditButton);
    await screen.findByRole('dialog', { name: '编辑流程' });
    expect(screen.queryByRole('button', { name: '开始流程' })).not.toBeInTheDocument();
  });
});
