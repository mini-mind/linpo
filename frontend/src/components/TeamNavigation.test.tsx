import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
          <Route path="/kanban" element={<div>kanban-page</div>} />
          <Route path="/flow/edit/:flowId" element={<div>flow-page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('navigation entries', () => {
  it('keeps 看板 as left text link without capsule background requirement', () => {
    renderLayout('/kanban');

    const kanbanLink = screen.getByRole('link', { name: '看板' });
    expect(kanbanLink).toHaveAttribute('href', '/kanban');
    expect(screen.getByRole('link', { name: '流程' })).toHaveAttribute('href', '/flow/edit/new');
  });

  it('hides legacy menu trigger in navigation', () => {
    renderLayout('/kanban');

    expect(screen.queryByRole('button', { name: '菜单' })).not.toBeInTheDocument();
  });
});
