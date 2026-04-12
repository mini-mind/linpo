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
  mockWriteInstanceFile,
  mockDeleteInstanceFile,
  mockBuildInstanceFileDownloadUrl,
  mockBuildInstanceAgentDocDownloadUrl,
} = vi.hoisted(() => ({
  mockResolveSingleInstance: vi.fn(),
  mockListInstanceFiles: vi.fn(),
  mockListInstanceAgentDocs: vi.fn(),
  mockPreviewInstanceFile: vi.fn(),
  mockPreviewInstanceAgentDoc: vi.fn(),
  mockWriteInstanceFile: vi.fn(),
  mockDeleteInstanceFile: vi.fn(),
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
    writeInstanceFile: mockWriteInstanceFile,
    deleteInstanceFile: mockDeleteInstanceFile,
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
    mockWriteInstanceFile.mockResolvedValue({
      path: '/home/node/.openclaw/workspace/demo/out.json',
      size_bytes: 18,
      updated_at: '2026-04-01T00:00:00Z',
      exists: true,
    });
    mockDeleteInstanceFile.mockResolvedValue({
      path: '/home/node/.openclaw/workspace/demo/out.json',
      deleted: true,
      updated_at: '2026-04-01T00:00:00Z',
    });
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

  it('renders mounted workspace tree and grouped agent docs, then keeps preview content full width on desktop', async () => {
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
        {
          id: 'agent-1:memory.md',
          agent_id: 'agent-1',
          agent_name: 'Alpha Agent',
          path: 'agent://agent-1/memory.md',
          name: 'memory.md',
          exists: true,
          size_bytes: 48,
          updated_at: '2026-04-01T00:00:00Z',
        },
        {
          id: 'agent-2:GUIDE.md',
          agent_id: 'agent-2',
          agent_name: 'Beta Agent',
          path: 'agent://agent-2/GUIDE.md',
          name: 'GUIDE.md',
          exists: true,
          size_bytes: 40,
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
      total: 3,
      existing_count: 3,
    });

    renderPage();

    await screen.findByRole('button', { name: '查看任务文件 out.json' });
    await userEvent.click(screen.getByRole('button', { name: '切换 Agents配置' }));
    await screen.findByRole('button', { name: '查看 Agent 文档 SOUL.md' });

    const shell = screen.getByTestId('instance-files-shell');
    const sidebar = screen.getByTestId('instance-files-sidebar');
    const pageRegion = screen.getByRole('region', { name: 'instance-files-page' });
    const contentFrame = shell.parentElement;
    const previewContent = screen.getByTestId('instance-files-preview-content');

    if (!contentFrame) {
      throw new Error('instance-files-shell 缺少内容 frame 父容器');
    }
    const bodyShell = contentFrame.parentElement;
    if (!bodyShell) {
      throw new Error('instance-files-content-frame 缺少 body shell 父容器');
    }

    expect(shell).toHaveStyle({ gridTemplateColumns: '320px minmax(0, 1fr)' });
    // 锁定页面框架贴边口径：section/body shell/inner 不能再引入页面级留白。
    expect(pageRegion).toHaveStyle({ gap: '0' });
    expect(bodyShell).toHaveStyle({ padding: '0px' });
    expect(contentFrame).toHaveStyle({ maxWidth: '100%' });
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回看板' })).not.toBeInTheDocument();
    expect(sidebar).not.toHaveTextContent('/home/node/.openclaw/workspace/');
    expect(sidebar).toHaveTextContent('demo');
    const agentDocList = screen.getByTestId('instance-agent-doc-list');
    // Agents 配置按 agent 分组展示，组标题与组下文档都应可见。
    expect(within(agentDocList).getByText('Alpha Agent')).toBeInTheDocument();
    expect(within(agentDocList).getByText('Beta Agent')).toBeInTheDocument();
    expect(within(agentDocList).getByRole('button', { name: '查看 Agent 文档 SOUL.md' })).toBeInTheDocument();
    expect(within(agentDocList).getByRole('button', { name: '查看 Agent 文档 GUIDE.md' })).toBeInTheDocument();
    expect(within(agentDocList).getByRole('button', { name: '查看 Agent 文档 memory.md' })).toBeInTheDocument();
    expect(sidebar).not.toHaveTextContent('流程：演示流程');
    expect(sidebar).not.toHaveTextContent('节点：产出节点');
    expect(sidebar).not.toHaveTextContent('产出');
    expect(within(sidebar).getByRole('button', { name: '新增任务文件' })).toBeInTheDocument();
    expect(within(sidebar).getAllByTestId('file-type-icon').length).toBeGreaterThan(0);
    expect(previewContent).toHaveStyle({ maxWidth: '100%', margin: '0px' });
    expect(screen.getByText('类型：产出')).toBeInTheDocument();
    expect(screen.getByText('状态：可访问')).toBeInTheDocument();
    expect(screen.getByText('流程：演示流程')).toBeInTheDocument();
    expect(screen.getByText('节点：产出节点')).toBeInTheDocument();
  });

  it('shows Agents配置 section collapsed by default and toggles grouped docs visibility', async () => {
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

    const sidebar = screen.getByTestId('instance-files-sidebar');
    const toggle = within(sidebar).getByRole('button', { name: '切换 Agents配置' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Alpha Agent')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看 Agent 文档 SOUL.md' })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Alpha Agent')).toBeVisible();
    expect(await screen.findByRole('button', { name: '查看 Agent 文档 SOUL.md' })).toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(screen.queryByText('Alpha Agent')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '查看 Agent 文档 SOUL.md' })).not.toBeInTheDocument();
    });
  });

  it('allows resizing sidebar width by dragging handle on desktop', async () => {
    renderPage();
    await screen.findByRole('button', { name: '查看任务文件 out.json' });

    const shell = screen.getByTestId('instance-files-shell');
    const resizer = screen.getByTestId('instance-files-sidebar-resizer');

    expect(shell).toHaveStyle({ gridTemplateColumns: '320px minmax(0, 1fr)' });
    await act(async () => {
      fireEvent.pointerDown(resizer, { pointerId: 11, clientX: 320 });
    });
    await act(async () => {
      fireEvent.pointerMove(window, { pointerId: 11, clientX: 408 });
    });
    await act(async () => {
      fireEvent.pointerUp(window, { pointerId: 11, clientX: 408 });
    });

    expect(shell).toHaveStyle({ gridTemplateColumns: '408px minmax(0, 1fr)' });
  });

  it('loads agent docs and renders markdown preview', async () => {
    mockListInstanceFiles.mockResolvedValue({
      items: [],
      total: 0,
      existing_count: 0,
    });
    mockListInstanceAgentDocs.mockResolvedValue({
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
    mockPreviewInstanceAgentDoc.mockResolvedValue({
      path: 'agent://agent-1/SOUL.md',
      kind: 'text',
      mime_type: 'text/markdown',
      size_bytes: 36,
      truncated: false,
      content: '# Soul\n\nAgent mission profile.',
      download_url: '/instances/inst-1/agent-docs/download?agentId=agent-1&name=SOUL.md',
    });

    renderPage();
    const sidebar = screen.getByTestId('instance-files-sidebar');
    await userEvent.click(within(sidebar).getByRole('button', { name: '切换 Agents配置' }));
    await screen.findByRole('button', { name: '查看 Agent 文档 SOUL.md' });

    await waitFor(() => {
      expect(mockPreviewInstanceAgentDoc).toHaveBeenCalledWith('inst-1', 'agent-1', 'SOUL.md');
    });
    expect(screen.getByText('Soul')).toBeInTheDocument();
    expect(screen.getByText('Agent mission profile.')).toBeInTheDocument();
  });

  it('locks agent docs as read-only', async () => {
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
      content: '# Soul\n\nReadonly.',
      download_url: '/instances/inst-1/agent-docs/download?agentId=agent-1&name=SOUL.md',
    });

    renderPage();
    const sidebar = screen.getByTestId('instance-files-sidebar');
    await userEvent.click(within(sidebar).getByRole('button', { name: '切换 Agents配置' }));
    await screen.findByRole('button', { name: '查看 Agent 文档 SOUL.md' });
    await userEvent.click(screen.getByRole('button', { name: '查看 Agent 文档 SOUL.md' }));
    const main = screen.getByTestId('instance-files-main');
    expect(await screen.findByText('文档权限：只读（MD 锁定）')).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: '编辑' })).toBeDisabled();
    expect(within(main).getByRole('button', { name: '删除' })).toBeDisabled();
    expect(within(sidebar).getByRole('button', { name: '新增任务文件' })).toBeEnabled();
  });

  it('creates task file via create dialog with directory and filename', async () => {
    renderPage();
    await screen.findByRole('button', { name: '查看任务文件 out.json' });
    const sidebar = screen.getByTestId('instance-files-sidebar');
    const createButton = within(sidebar).getByRole('button', { name: '新增任务文件' });
    await userEvent.click(createButton);

    const createDialog = await screen.findByRole('dialog', { name: '新增任务文件' });
    await userEvent.selectOptions(within(createDialog).getByRole('combobox', { name: '新文件目录' }), '__shared_root__');
    const filenameInput = within(createDialog).getByRole('textbox', { name: '新文件名' });
    await userEvent.type(filenameInput, 'new-created.json');
    await userEvent.click(within(createDialog).getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(mockWriteInstanceFile).toHaveBeenCalledWith('inst-1', {
        boardId: 'default',
        path: 'new-created.json',
        content: '',
      });
    });
  });

  it('opens create dialog from shared root even when task files are empty', async () => {
    mockListInstanceFiles.mockResolvedValueOnce({
      items: [],
      total: 0,
      existing_count: 0,
    });
    mockListInstanceAgentDocs.mockResolvedValueOnce({
      items: [],
      total: 0,
      existing_count: 0,
    });

    renderPage();
    const sidebar = await screen.findByTestId('instance-files-sidebar');
    await userEvent.click(within(sidebar).getByRole('button', { name: '新增任务文件' }));

    const createDialog = await screen.findByRole('dialog', { name: '新增任务文件' });
    await userEvent.type(within(createDialog).getByRole('textbox', { name: '新文件名' }), 'root-created.md');
    await userEvent.click(within(createDialog).getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(mockWriteInstanceFile).toHaveBeenCalledWith('inst-1', {
        boardId: 'default',
        path: 'root-created.md',
        content: '',
      });
    });
  });

  it('keeps add/edit/delete buttons disabled when no task file is selected', async () => {
    mockListInstanceFiles.mockResolvedValue({
      items: [],
      total: 0,
      existing_count: 0,
    });
    mockListInstanceAgentDocs.mockResolvedValue({
      items: [],
      total: 0,
      existing_count: 0,
    });

    renderPage();
    await screen.findByText('选择文件后查看预览');

    const sidebar = screen.getByTestId('instance-files-sidebar');
    expect(within(sidebar).getByRole('button', { name: '新增任务文件' })).toBeEnabled();
  });

  it('supports task file update and delete operations', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByRole('button', { name: '查看任务文件 out.json' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务文件 out.json' }));
    await userEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const editor = await screen.findByLabelText('文件编辑器');
    fireEvent.change(editor, { target: { value: '{"result":"updated"}' } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockWriteInstanceFile).toHaveBeenCalledWith('inst-1', {
        taskId: 'task-1',
        boardId: 'default',
        path: '/home/node/.openclaw/workspace/demo/out.json',
        content: '{"result":"updated"}',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(mockDeleteInstanceFile).toHaveBeenCalledWith('inst-1', {
        taskId: 'task-1',
        boardId: 'default',
        path: '/home/node/.openclaw/workspace/demo/out.json',
      });
    });
    confirmSpy.mockRestore();
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
    const drawer = await screen.findByRole('dialog', { name: '文件侧栏抽屉' });
    expect(drawer).toHaveStyle({ zIndex: '90' });
    expect(screen.getByLabelText('搜索实例文件')).toHaveStyle({ width: '100%' });
    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '文件侧栏抽屉' })).not.toBeInTheDocument();
    });

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
    expect(screen.getByText('暂无文件')).toBeInTheDocument();
    expect(mockListInstanceFiles).not.toHaveBeenCalled();
    expect(mockListInstanceAgentDocs).not.toHaveBeenCalled();
  });
});
