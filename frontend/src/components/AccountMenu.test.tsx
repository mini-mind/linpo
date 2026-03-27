import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockUsername = 'alice';
const mockLogout = vi.fn(async () => {});
const mockAddToast = vi.fn();

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: mockUsername },
    logout: mockLogout,
  }),
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

import { AccountMenu } from './AccountMenu';

describe('AccountMenu avatar trigger text', () => {
  beforeEach(() => {
    mockUsername = 'alice';
    mockLogout.mockClear();
    mockAddToast.mockClear();
  });

  it('uses first Chinese character when username starts with Chinese', () => {
    mockUsername = '张三';
    render(<AccountMenu triggerVariant="icon" />);

    expect(screen.getByRole('button', { name: '打开账户菜单' })).toHaveTextContent('张');
  });

  it('uses first two characters uppercased for English or digits', () => {
    mockUsername = 'a9test';
    render(<AccountMenu triggerVariant="icon" />);

    expect(screen.getByRole('button', { name: '打开账户菜单' })).toHaveTextContent('A9');
  });

  it('falls back to U when username is empty after trim', () => {
    mockUsername = '   ';
    render(<AccountMenu triggerVariant="icon" />);

    expect(screen.getByRole('button', { name: '打开账户菜单' })).toHaveTextContent('U');
  });
});
