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

vi.mock('./Layout', () => ({
  Layout: () => <Outlet />,
  RedirectToSummary: () => <Navigate to="/summary" replace />,
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

vi.mock('./InstanceFilesPage', () => ({
  InstanceFilesPage: () => <div>files-page</div>,
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

  it('renders /files as first-class app route', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/files');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/files');
    });

    expect(screen.getByText('files-page')).toBeInTheDocument();
  });

  it('keeps /instance-files compatible by redirecting to /files', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', '/instance-files');

    await act(async () => {
      await import('../main');
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/files');
    });

    expect(screen.getByText('files-page')).toBeInTheDocument();
  });

});
