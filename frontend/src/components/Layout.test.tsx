import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
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
          <Route path="/flow" element={<div>流程内容</div>} />
          <Route path="/flow/edit/:flowId" element={<div>流程编辑内容</div>} />
          <Route path="/pairing" element={<div>接入内容</div>} />
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

    expect(screen.getByRole('link', { name: '灵盘' })).toHaveAttribute('href', '/landing');
    expect(screen.getByRole('link', { name: '看板' })).toHaveAttribute('href', '/kanban');
    expect(screen.getByRole('link', { name: '流程' })).toHaveAttribute('href', '/flow');
    expect(screen.queryByRole('link', { name: '实例' })).not.toBeInTheDocument();
    expect(screen.getByTestId('toolbar-nav-divider')).toBeInTheDocument();
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
});
