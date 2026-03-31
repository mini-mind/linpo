import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockUsername = 'alice';
let mockAvatarUrl: string | null = null;
const mockLogout = vi.fn(async () => {});
const mockAddToast = vi.fn();

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: mockUsername, avatar_url: mockAvatarUrl },
    logout: mockLogout,
  }),
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

vi.mock('../api/messageClient', () => ({
  listUserMessages: vi.fn(async () => []),
  readUserMessage: vi.fn(async () => ({ read: true })),
}));

vi.mock('./InstanceListModal', () => ({
  InstanceListModal: ({ open }: { open: boolean }) => (open ? <div>实例列表弹窗</div> : null),
}));

vi.mock('./UserProfileModal', () => ({
  UserProfileModal: ({ open }: { open: boolean }) => (open ? <div>用户信息弹窗</div> : null),
}));

import { AccountMenu } from './AccountMenu';

describe('AccountMenu avatar trigger text', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockUsername = 'alice';
    mockAvatarUrl = null;
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

  it('renders avatar image when avatar_url exists', () => {
    mockAvatarUrl = 'data:image/png;base64,AAAA';
    render(<AccountMenu triggerVariant="icon" />);

    const avatar = screen.getByRole('img', { name: '用户头像' });
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', mockAvatarUrl);
  });

  it('opens user profile modal from account menu item', async () => {
    render(<AccountMenu triggerVariant="icon" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '账户' }));
    });
    expect(screen.getByText('用户信息弹窗')).toBeInTheDocument();
  });

  it('opens instance list modal from instance menu item', async () => {
    render(<AccountMenu triggerVariant="icon" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '实例' }));
    });
    expect(screen.getByText('实例列表弹窗')).toBeInTheDocument();
  });
});
