import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SessionActions } from './SessionActions';

describe('SessionActions readonly mode', () => {
  it('shows readonly hint instead of destructive controls', () => {
    render(<SessionActions sessionKey="session-1" />);

    expect(screen.getByText(/当前阶段仅保留观察与进入能力/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /暂停/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重置会话/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除会话/i })).not.toBeInTheDocument();
  });
});
