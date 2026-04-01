import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../hooks/useToast';
import { InstanceFilesPage } from './InstanceFilesPage';

const {
  mockListInstances,
  mockListInstanceFiles,
  mockPreviewInstanceFile,
  mockBuildInstanceFileDownloadUrl,
} = vi.hoisted(() => ({
  mockListInstances: vi.fn(),
  mockListInstanceFiles: vi.fn(),
  mockPreviewInstanceFile: vi.fn(),
  mockBuildInstanceFileDownloadUrl: vi.fn(),
}));

vi.mock('../api/instanceClient', async () => {
  const actual = await vi.importActual<typeof import('../api/instanceClient')>('../api/instanceClient');
  return {
    ...actual,
    listInstances: mockListInstances,
    listInstanceFiles: mockListInstanceFiles,
    previewInstanceFile: mockPreviewInstanceFile,
    buildInstanceFileDownloadUrl: mockBuildInstanceFileDownloadUrl,
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
  });

  it('loads instance files and renders json preview', async () => {
    renderPage();
    await screen.findByRole('button', { name: '查看文件 out.json' });

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
});
