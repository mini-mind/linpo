import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../hooks/useToast';
import { InstanceFilesPage } from './InstanceFilesPage';

const {
  mockListInstances,
  mockListInstanceFiles,
  mockListInstanceAgentDocs,
  mockPreviewInstanceFile,
  mockPreviewInstanceAgentDoc,
  mockBuildInstanceFileDownloadUrl,
  mockBuildInstanceAgentDocDownloadUrl,
} = vi.hoisted(() => ({
  mockListInstances: vi.fn(),
  mockListInstanceFiles: vi.fn(),
  mockListInstanceAgentDocs: vi.fn(),
  mockPreviewInstanceFile: vi.fn(),
  mockPreviewInstanceAgentDoc: vi.fn(),
  mockBuildInstanceFileDownloadUrl: vi.fn(),
  mockBuildInstanceAgentDocDownloadUrl: vi.fn(),
}));

vi.mock('../api/instanceClient', async () => {
  const actual = await vi.importActual<typeof import('../api/instanceClient')>('../api/instanceClient');
  return {
    ...actual,
    listInstances: mockListInstances,
    listInstanceFiles: mockListInstanceFiles,
    listInstanceAgentDocs: mockListInstanceAgentDocs,
    previewInstanceFile: mockPreviewInstanceFile,
    previewInstanceAgentDoc: mockPreviewInstanceAgentDoc,
    buildInstanceFileDownloadUrl: mockBuildInstanceFileDownloadUrl,
    buildInstanceAgentDocDownloadUrl: mockBuildInstanceAgentDocDownloadUrl,
  };
});

function renderPage(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <InstanceFilesPage />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('InstanceFilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListInstances.mockResolvedValue([
      {
        id: 'inst-1',
        name: 'claw1',
        type: 'openclaw',
        endpoint: 'http://127.0.0.1:28789',
        status: 'ok',
        last_check_at: null,
        created_at: '2026-04-01T00:00:00Z',
      },
    ]);
    mockListInstanceFiles.mockResolvedValue({
      items: [
        {
          id: 'task-1:/tmp/linpo/demo/out.json',
          task_id: 'task-1',
          task_title: '产出节点',
          task_status: 'completed',
          requirement_id: 'req-demo',
          path: '/tmp/linpo/demo/out.json',
          name: 'out.json',
          exists: true,
          size_bytes: 18,
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
      total: 1,
      existing_count: 1,
    });
    mockListInstanceAgentDocs.mockResolvedValue({
      items: [],
      total: 0,
      existing_count: 0,
    });
    mockPreviewInstanceFile.mockResolvedValue({
      path: '/tmp/linpo/demo/out.json',
      kind: 'json',
      mime_type: 'application/json',
      size_bytes: 18,
      truncated: false,
      content: '{"result":"ok"}',
      download_url: '/instances/inst-1/files/download?taskId=task-1',
    });
    mockBuildInstanceFileDownloadUrl.mockReturnValue('/instances/inst-1/files/download?taskId=task-1');
    mockBuildInstanceAgentDocDownloadUrl.mockReturnValue(
      '/instances/inst-1/agent-docs/download?agentId=agent-1&name=SOUL.md'
    );
  });

  it('loads instance files and renders json preview', async () => {
    renderPage();
    await screen.findByRole('button', { name: '查看任务文件 out.json' });

    await waitFor(() => {
      expect(mockPreviewInstanceFile).toHaveBeenCalledWith(
        'inst-1',
        'task-1',
        '/tmp/linpo/demo/out.json',
        { boardId: 'default' }
      );
    });
    expect(screen.getByText(/"result": "ok"/)).toBeInTheDocument();
  });

  it('loads agent docs and renders markdown preview', async () => {
    mockListInstanceFiles.mockResolvedValueOnce({
      items: [],
      total: 0,
      existing_count: 0,
    });
    mockListInstanceAgentDocs.mockResolvedValueOnce({
      items: [
        {
          id: 'agent-1:SOUL.md',
          agent_id: 'agent-1',
          agent_name: 'Claw Planner',
          path: 'agent://agent-1/SOUL.md',
          name: 'SOUL.md',
          exists: true,
          size_bytes: 36,
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
      total: 1,
      existing_count: 1,
    });
    mockPreviewInstanceAgentDoc.mockResolvedValueOnce({
      path: 'agent://agent-1/SOUL.md',
      kind: 'text',
      mime_type: 'text/markdown',
      size_bytes: 36,
      truncated: false,
      content: '# Soul\n\nAgent mission profile.',
      download_url: '/instances/inst-1/agent-docs/download?agentId=agent-1&name=SOUL.md',
    });

    renderPage();
    await screen.findByRole('button', { name: '查看 Agent 文档 SOUL.md' });

    await waitFor(() => {
      expect(mockPreviewInstanceAgentDoc).toHaveBeenCalledWith('inst-1', 'agent-1', 'SOUL.md');
    });
    expect(screen.getByText('Soul')).toBeInTheDocument();
    expect(screen.getByText('Agent mission profile.')).toBeInTheDocument();
  });

  it('uses compact stats and full-width controls on mobile', async () => {
    const originalWidth = window.innerWidth;
    await act(async () => {
      window.innerWidth = 480;
      window.dispatchEvent(new Event('resize'));
    });

    renderPage();

    await screen.findByRole('button', { name: '查看任务文件 out.json' });
    expect(screen.getByText('总文件数 1')).toBeInTheDocument();
    expect(screen.getByText('可访问 1')).toBeInTheDocument();
    expect(screen.queryByText('任务产物 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent 文档 0')).not.toBeInTheDocument();
    expect(screen.getByLabelText('选择实例')).toHaveStyle({ width: '100%' });
    expect(screen.getByLabelText('搜索实例文件')).toHaveStyle({ width: '100%' });

    await act(async () => {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event('resize'));
    });
  });
});
