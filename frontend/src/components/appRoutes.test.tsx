import '@testing-library/jest-dom';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useAuth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../hooks/useToast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../routes', () => ({
  ProtectedRoute: () => <Outlet />,
  PublicRoute: () => <Outlet />,
}));

vi.mock('./Layout', () => ({
  Layout: () => <Outlet />,
  RedirectToOverview: () => <div>redirect-kanban</div>,
}));

vi.mock('./CollabPage', () => ({
  default: () => <div>kanban-page</div>,
}));

vi.mock('./FlowPage', () => ({
  FlowPage: () => <div>flow-page</div>,
}));

vi.mock('./FlowListPage', () => ({
  FlowListPage: () => <div>flow-list-page</div>,
}));

vi.mock('./LandingPage', () => ({
  LandingPage: () => <div>landing-page</div>,
}));

vi.mock('./LoginPage', () => ({
  LoginPage: () => <div>login-page</div>,
}));

vi.mock('./PairingPage', () => ({
  PairingPage: () => <div>pairing-page</div>,
}));

vi.mock('./PairingTutorialPage', () => ({
  PairingTutorialPage: () => <div>pairing-tutorial-page</div>,
}));

describe('app routes', () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/');
  });

  it('redirects unknown path to /kanban in authenticated app shell', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/unknown');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/kanban');
    });

    expect(screen.getByText('kanban-page')).toBeInTheDocument();
  });

  it('renders /kanban as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/kanban');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/kanban');
    });

    expect(screen.getByText('kanban-page')).toBeInTheDocument();
  });

  it('renders /flow as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/flow');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/flow');
    });

    expect(screen.getByText('flow-list-page')).toBeInTheDocument();
  });

  it('renders /flow/edit/:flowId as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/flow/edit/new');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/flow/edit/new');
    });

    expect(screen.getByText('flow-page')).toBeInTheDocument();
  });

  it('renders /landing as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/landing');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/landing');
    });

    expect(screen.getByText('landing-page')).toBeInTheDocument();
  });

  it('renders /pairing as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/pairing');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/pairing');
    });

    expect(screen.getByText('pairing-page')).toBeInTheDocument();
  });

  it('renders /pairing/tutorial as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/pairing/tutorial');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/pairing/tutorial');
    });

    expect(screen.getByText('pairing-tutorial-page')).toBeInTheDocument();
  });
});
