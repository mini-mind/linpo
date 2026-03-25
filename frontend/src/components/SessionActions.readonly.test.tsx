import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SessionActions } from './SessionActions';

describe('SessionActions', () => {
  it('renders real action buttons when handlers are provided', () => {
    render(
      <SessionActions
        sessionKey="session-1"
        onPause={vi.fn().mockResolvedValue(undefined)}
        onReset={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: /^暂停$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^重置会话$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^删除会话$/i })).toBeInTheDocument();
  });

  it('shows loading state while action is running', async () => {
    let resolvePause!: () => void;
    const onPause = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePause = resolve;
        }),
    );
    render(<SessionActions sessionKey="session-1" onPause={onPause} />);

    await userEvent.click(screen.getByRole('button', { name: /^暂停$/i }));

    expect(screen.getByRole('button', { name: /^暂停中\.\.\.$/i })).toBeDisabled();

    resolvePause();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^暂停$/i })).toBeEnabled();
    });
  });

  it('shows inline error message when action fails', async () => {
    render(
      <SessionActions
        sessionKey="session-1"
        onDelete={vi.fn().mockRejectedValue(new Error('删除会话失败'))}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^删除会话$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '操作失败：删除会话失败',
    );
  });
});
