import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../hooks/useToast';
import { InstanceFilesPage } from './InstanceFilesPage';

const {
  mockResolveSingleInstance,
  mockListInstanceFiles,
  mockListInstanceAgentDocs,
  mockPreviewInstanceFile,
  mockPreviewInstanceAgentDoc,
  mockBuildInstanceFileDownloadUrl,
  mockBuildInstanceAgentDocDownloadUrl,
} = vi.hoisted(() => ({
  mockResolveSingleInstance: vi.fn(),
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
    resolveSingleInstance: mockResolveSingleInstance,
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
    mockResolveSingleInstance.mockResolvedValue({
      instance: {
        id: 'inst-1',
        name: 'claw1',
        type: 'openclaw',
        endpoint: 'http://127.0.0.1:28789',
        status: 'ok',
        last_check_at: null,
        created_at: '2026-04-01T00:00:00Z',
      },
      total: 1,
    });
    mockListInstanceFiles.mockResolvedValue({
      items: [
        {
          id: 'task-1:/home/node/.openclaw/workspace/demo/out.json',
          task_id: 'task-1',
          agent_id: 'agent-1',
          agent_name: 'Alpha Agent',
          task_title: '产出节点',
          task_status: 'completed',
          requirement_id: 'req-demo',
          requirement_title: '演示流程',
          path: '/home/node/.openclaw/workspace/demo/out.json',
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
      path: '/home/node/.openclaw/workspace/demo/out.json',
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
        '/home/node/.openclaw/workspace/demo/out.json',
        { boardId: 'default' }
      );
    });
    expect(screen.getByText(/"result": "ok"/)).toBeInTheDocument();
  });

  it('renders desktop path tree and keeps preview content centered', async () => {
    mockListInstanceAgentDocs.mockResolvedValueOnce({
      items: [
        {
          id: 'agent-1:SOUL.md',
          agent_id: 'agent-1',
          agent_name: 'Alpha Agent',
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

    renderPage();

    await screen.findByRole('button', { name: '查看任务文件 out.json' });
    await screen.findByRole('button', { name: '查看 Agent 文档 SOUL.md' });

    const shell = screen.getByTestId('instance-files-shell');
    const sidebar = screen.getByTestId('instance-files-sidebar');
    const previewContent = screen.getByTestId('instance-files-preview-content');

    expect(shell).toHaveStyle({ gridTemplateColumns: '320px 10px minmax(0, 1fr)' });
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回看板' })).not.toBeInTheDocument();
    expect(sidebar).toHaveTextContent('claw1');
    expect(sidebar).toHaveTextContent('文件树');
    expect(sidebar).not.toHaveTextContent('/home/node/.openclaw/workspace/');
    expect(sidebar).toHaveTextContent('demo');
    expect(sidebar).toHaveTextContent('agents');
    expect(sidebar).toHaveTextContent('agent-1');
    expect(sidebar).not.toHaveTextContent('流程：演示流程');
    expect(sidebar).not.toHaveTextContent('节点：产出节点');
    expect(sidebar).not.toHaveTextContent('配置');
    expect(sidebar).not.toHaveTextContent('产出');
    expect(within(sidebar).getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(within(sidebar).getAllByTestId('file-type-icon').length).toBeGreaterThan(0);
    expect(previewContent).toHaveStyle({ maxWidth: '960px', margin: '0 auto' });
    expect(screen.getByText('类型：产出')).toBeInTheDocument();
    expect(screen.getByText('状态：可访问')).toBeInTheDocument();
    expect(screen.getByText('流程：演示流程')).toBeInTheDocument();
    expect(screen.getByText('节点：产出节点')).toBeInTheDocument();
  });

  it('allows resizing sidebar width by dragging handle on desktop', async () => {
    renderPage();
    await screen.findByRole('button', { name: '查看任务文件 out.json' });

    const shell = screen.getByTestId('instance-files-shell');
    const resizer = screen.getByTestId('instance-files-sidebar-resizer');

    expect(shell).toHaveStyle({ gridTemplateColumns: '320px 10px minmax(0, 1fr)' });
    await act(async () => {
      fireEvent.pointerDown(resizer, { pointerId: 11, clientX: 320 });
    });
    await act(async () => {
      fireEvent.pointerMove(window, { pointerId: 11, clientX: 408 });
    });
    await act(async () => {
      fireEvent.pointerUp(window, { pointerId: 11, clientX: 408 });
    });

    expect(shell).toHaveStyle({ gridTemplateColumns: '408px 10px minmax(0, 1fr)' });
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

  it('uses full-width controls on mobile', async () => {
    const originalWidth = window.innerWidth;
    await act(async () => {
      window.innerWidth = 480;
      window.dispatchEvent(new Event('resize'));
    });

    renderPage();

    await screen.findByRole('button', { name: '打开文件侧栏' });
    expect(screen.getByTestId('instance-files-content-frame')).toHaveStyle({ gridTemplateColumns: '1fr' });
    expect(screen.getByTestId('instance-files-content-frame')).toHaveStyle({ gridTemplateRows: 'minmax(0, 1fr)' });

    await userEvent.click(screen.getByRole('button', { name: '打开文件侧栏' }));
    await screen.findByRole('dialog', { name: '文件侧栏抽屉' });
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(screen.getByLabelText('当前实例')).toHaveTextContent('实例：claw1');
    expect(screen.getByLabelText('搜索实例文件')).toHaveStyle({ width: '100%' });

    await act(async () => {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event('resize'));
    });
  });

  it('shows configuration hint when no single instance is configured', async () => {
    mockResolveSingleInstance.mockResolvedValueOnce({
      instance: null,
      total: 0,
    });

    renderPage();

    expect(await screen.findByText('未检测到可用实例。请先在服务端配置 1 个实例后刷新。')).toBeInTheDocument();
    expect(screen.getByLabelText('当前实例')).toHaveTextContent('实例：未配置');
    expect(screen.getByText('暂无文件')).toBeInTheDocument();
    expect(mockListInstanceFiles).not.toHaveBeenCalled();
    expect(mockListInstanceAgentDocs).not.toHaveBeenCalled();
  });
});
