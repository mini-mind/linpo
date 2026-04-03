import '@testing-library/jest-dom';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { Navigate, Outlet } from 'react-router-dom';
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
  RedirectToOverview: () => <Navigate to="/summary" replace />,
}));

vi.mock('./CollabPage', () => ({
  default: () => <div>kanban-page</div>,
}));

vi.mock('./SummaryPage', () => ({
  SummaryPage: () => <div>summary-page</div>,
}));

vi.mock('./FlowPage', () => ({
  FlowPage: () => <div>flow-page</div>,
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

vi.mock('./PairingReceiptConfirmPage', () => ({
  PairingReceiptConfirmPage: () => <div>pairing-receipt-confirm-page</div>,
}));

vi.mock('./ProfilePage', () => ({
  ProfilePage: () => <div>profile-page</div>,
}));

describe('app routes', () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/');
  });

  it('redirects unknown path to /summary in authenticated app shell', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/unknown');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/summary');
    });

    expect(screen.getByText('summary-page')).toBeInTheDocument();
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

  it('renders /summary as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/summary');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/summary');
    });

    expect(screen.getByText('summary-page')).toBeInTheDocument();
  });

  it('redirects root path to /summary in authenticated app shell', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/summary');
    });

    expect(screen.getByText('summary-page')).toBeInTheDocument();
  });

  it('redirects /flow to /flow/edit/new', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/flow');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/flow/edit/new');
    });

    expect(screen.getByText('flow-page')).toBeInTheDocument();
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

  it('renders /profile as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/profile');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/profile');
    });

    expect(screen.getByText('profile-page')).toBeInTheDocument();
  });
});
