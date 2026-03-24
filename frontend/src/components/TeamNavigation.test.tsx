import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));

vi.mock('../hooks/useToast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    toasts: [],
    removeToast: vi.fn(),
  }),
}));

vi.mock('./AccountMenu', () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));

import { useIsMobile } from '../hooks/useIsMobile';
import { Layout } from './Layout';

const mockUseIsMobile = vi.mocked(useIsMobile);

function renderLayout(initialPath = '/team') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/overview" element={<div>overview-page</div>} />
          <Route path="/topology" element={<div>topology-page</div>} />
          <Route path="/kanban" element={<div>kanban-page</div>} />
          <Route path="/team" element={<div>team-page</div>} />
          <Route path="/session" element={<div>session-page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('team navigation entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows team in the desktop primary navigation', () => {
    mockUseIsMobile.mockReturnValue(false);

    renderLayout();

    expect(screen.getByRole('link', { name: /团队/ })).toHaveAttribute('href', '/team');
  });

  it('shows team in the mobile primary navigation', () => {
    mockUseIsMobile.mockReturnValue(true);

    renderLayout();

    expect(screen.getByRole('link', { name: /团队/ })).toHaveAttribute('href', '/team');
  });
});
