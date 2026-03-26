import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import { Layout } from './Layout';

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper component that sets initial location
function TestWrapper({ 
  children, 
  initialPath = '/topology' 
}: { 
  children: React.ReactNode; 
  initialPath?: string;
}) {
  // Set initial URL
  window.history.pushState({}, '', initialPath);
  return <>{children}</>;
}

describe('Layout sidebar account area', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows account menu in sidebar footer when authenticated', async () => {
    // Mock authenticated user
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/overview" element={<div>总览页内容</div>} />
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                  <Route path="/session" element={<div>会话页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    // Wait for auth check and layout to render
    await waitFor(() => {
      expect(screen.queryByText('灵')).toBeInTheDocument();
    });

    // Should show username in account area
    expect(await screen.findByText('testuser')).toBeInTheDocument();

    // Logout should NOT be visible by default (only after opening menu)
    expect(screen.queryByText('退出登录')).not.toBeInTheDocument();
  });

  it('does not show account menu when not authenticated', async () => {
    // Mock unauthenticated user
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Unauthorized' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    // Wait for auth check to complete
    await waitFor(() => {
      expect(screen.queryByText('灵')).toBeInTheDocument();
    });

    // Should NOT show account menu elements when not logged in
    const usernameElements = screen.queryAllByText(/testuser|退出登录/);
    expect(usernameElements.length).toBe(0);
  });

  it('calls logout API when clicking logout', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    // Wait for auth to load
    await screen.findByText('testuser');

    // Setup logout mock
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    // Logout should NOT be visible initially
    expect(screen.queryByText('退出登录')).not.toBeInTheDocument();

    // Click on username to open the menu
    const usernameButton = screen.getByLabelText('打开账户菜单');
    await userEvent.click(usernameButton);

    // Now logout should be visible
    const logoutButton = screen.getByText('退出登录');
    expect(logoutButton).toBeInTheDocument();

    // Click logout
    await userEvent.click(logoutButton);

    // Should call logout endpoint
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/logout'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        })
      );
    });
  });

  it('does not show instance info in account area', async () => {
    // Mock authenticated user
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    // Wait for layout to render
    await screen.findByText('testuser');

    // Should NOT show instance-related content
    const instanceTexts = screen.queryAllByText(/实例|instance|claw|endpoint/);
    expect(instanceTexts.length).toBe(0);
  });

  it('toggles aria-expanded when opening and closing the menu', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    const usernameButton = await screen.findByLabelText('打开账户菜单');

    expect(usernameButton).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(usernameButton);
    expect(usernameButton).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(document.body);
    expect(usernameButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens menu with Enter key', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    const usernameButton = await screen.findByLabelText('打开账户菜单');
    usernameButton.focus();

    await userEvent.keyboard('{Enter}');

    expect(usernameButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('退出登录')).toBeInTheDocument();
  });

  it('opens menu with Space key', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    const usernameButton = await screen.findByLabelText('打开账户菜单');
    usernameButton.focus();

    await userEvent.keyboard(' ');

    expect(usernameButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('退出登录')).toBeInTheDocument();
  });

  it('keeps topology as a direct navigation entry', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/overview" element={<div>总览页内容</div>} />
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    await screen.findByText('testuser');

    const overviewEntry = screen.getByRole('link', { name: '进入总览' });
    const topologyLink = screen.getAllByRole('link', { name: /拓扑/ })[0];
    expect(overviewEntry).toHaveAttribute('href', '/overview');
    expect(topologyLink).toHaveAttribute('href', '/topology');
    expect(screen.queryByRole('link', { name: /会话/ })).not.toBeInTheDocument();
  });

  it('shows topology/kanban/team as desktop primary navigation entries', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/overview">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/overview" element={<div>总览页内容</div>} />
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    await screen.findByText('testuser');

    const topologyLink = screen.getAllByRole('link', { name: /拓扑/ })[0];
    const kanbanLink = screen.getAllByRole('link', { name: /看板/ })[0];
    const teamLink = screen.getAllByRole('link', { name: /团队/ })[0];

    expect(topologyLink).toHaveAttribute('href', '/topology');
    expect(kanbanLink).toHaveAttribute('href', '/kanban');
    expect(teamLink).toHaveAttribute('href', '/team');
    expect(screen.queryByRole('link', { name: /^总览$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /会话/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /协作/ })).not.toBeInTheDocument();
  });

  it('renders main content area with layout-main-shell testid', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', username: 'testuser' }),
    });

    render(
      <TestWrapper initialPath="/topology">
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/topology" element={<div>拓扑页内容</div>} />
                </Route>
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </TestWrapper>
    );

    await screen.findByText('testuser');

    const mainShell = screen.getByTestId('layout-main-shell');
    expect(mainShell).toBeInTheDocument();
    expect(mainShell).toHaveTextContent('拓扑页内容');
  });
});
