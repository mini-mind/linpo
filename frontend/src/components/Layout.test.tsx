import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({
    toasts: [],
    removeToast: vi.fn(),
  }),
}));

vi.mock('./AccountMenu', () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));

import { Layout } from './Layout';

function renderLayout(initialPath = '/kanban') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/kanban" element={<div>看板内容</div>} />
          <Route path="/flow/edit/:flowId" element={<div>流程编辑内容</div>} />
          <Route path="/instance-files" element={<div>文件内容</div>} />
          <Route path="/files" element={<div>文件内容（新路由）</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Layout', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders toolbar and main shell', () => {
    renderLayout('/kanban');

    expect(screen.getByRole('link', { name: '看板' })).toHaveAttribute('href', '/kanban');
    expect(screen.getByRole('link', { name: '流程' })).toHaveAttribute('href', '/flow/edit/new');
    expect(screen.getByRole('link', { name: '文件' })).toHaveAttribute('href', '/instance-files');
    expect(screen.queryByRole('link', { name: '实例' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('toolbar-nav-divider')).toHaveLength(4);
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveStyle({ position: 'relative', zIndex: '80', overflow: 'visible' });
    expect(screen.getByTestId('layout-main-shell')).toHaveTextContent('看板内容');
  });

  it('does not render legacy menu trigger', () => {
    renderLayout('/kanban');
    expect(screen.queryByRole('button', { name: '菜单' })).not.toBeInTheDocument();
  });

  it('uses cached flow editor path as flow nav target', () => {
    window.localStorage.setItem('linpo.lastFlowEntryPath', '/flow/edit/req-latest');
    renderLayout('/kanban');
    expect(screen.getByRole('link', { name: '流程' })).toHaveAttribute('href', '/flow/edit/req-latest');
  });

  it('falls back to /flow/edit/new when cached flow path is malformed', async () => {
    window.localStorage.setItem('linpo.lastFlowEntryPath', '/flow/edit/');
    renderLayout('/kanban');

    const flowLink = screen.getByRole('link', { name: '流程' });
    expect(flowLink).toHaveAttribute('href', '/flow/edit/new');

    await userEvent.click(flowLink);
    expect(screen.getByTestId('layout-main-shell')).toHaveTextContent('流程编辑内容');
  });

  it('navigates to flow entry when clicking flow nav from kanban', async () => {
    renderLayout('/kanban');

    await userEvent.click(screen.getByRole('link', { name: '流程' }));

    expect(screen.getByTestId('layout-main-shell')).toHaveTextContent('流程编辑内容');
  });

  it('navigates directly without showing route transition hint when clicking top nav', async () => {
    renderLayout('/kanban');

    await userEvent.click(screen.getByRole('link', { name: '流程' }));

    expect(screen.getByTestId('layout-main-shell')).toHaveTextContent('流程编辑内容');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps main nav horizontally scrollable on mobile', () => {
    const originalWidth = window.innerWidth;
    window.innerWidth = 480;

    renderLayout('/kanban');

    const nav = screen.getByTestId('layout-main-nav');
    expect(nav).toHaveStyle({ overflowX: 'auto' });
    expect(nav).toHaveStyle({ overflowY: 'hidden' });
    expect(nav).toHaveStyle({ touchAction: 'pan-x' });

    window.innerWidth = originalWidth;
  });

  it('uses edge-to-edge main shell for /files route', () => {
    renderLayout('/files');

    const mainShell = screen.getByTestId('layout-main-shell');
    expect(mainShell).toHaveStyle({ padding: '0px' });
    expect(mainShell).toHaveTextContent('文件内容（新路由）');
  });

});
