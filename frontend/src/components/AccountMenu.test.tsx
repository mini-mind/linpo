import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockUsername = 'alice';
let mockAvatarUrl: string | null = null;

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u-1', username: mockUsername, avatar_url: mockAvatarUrl },
  }),
}));

vi.mock('../api/messageClient', () => ({
  listUserMessages: vi.fn(async () => []),
  readUserMessage: vi.fn(async () => ({ read: true })),
}));

vi.mock('./MessageCenterModal', () => ({
  MessageCenterModal: () => null,
}));

vi.mock('./UserProfileModal', () => ({
  UserProfileModal: ({ open }: { open: boolean }) => (open ? <div>用户信息弹窗</div> : null),
}));

import { AccountMenu } from './AccountMenu';

function renderMenu(): void {
  render(
    <MemoryRouter>
      <AccountMenu triggerVariant="icon" />
    </MemoryRouter>
  );
}

describe('AccountMenu avatar trigger text', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockUsername = 'alice';
    mockAvatarUrl = null;
    vi.restoreAllMocks();
  });

  it('uses first Chinese character when username starts with Chinese', () => {
    mockUsername = '张三';
    renderMenu();

    expect(screen.getByRole('button', { name: '打开账户菜单' })).toHaveTextContent('张');
  });

  it('uses first two characters uppercased for English or digits', () => {
    mockUsername = 'a9test';
    renderMenu();

    expect(screen.getByRole('button', { name: '打开账户菜单' })).toHaveTextContent('A9');
  });

  it('falls back to U when username is empty after trim', () => {
    mockUsername = '   ';
    renderMenu();

    expect(screen.getByRole('button', { name: '打开账户菜单' })).toHaveTextContent('U');
  });

  it('renders avatar image when avatar_url exists', () => {
    mockAvatarUrl = 'data:image/png;base64,AAAA';
    renderMenu();

    const avatar = screen.getByRole('img', { name: '用户头像' });
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', mockAvatarUrl);
  });

  it('opens user profile modal from account menu item', async () => {
    renderMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '账户' }));
    });
    expect(screen.getByText('用户信息弹窗')).toBeInTheDocument();
  });

  it('does not render instance files menu item in account dropdown', async () => {
    renderMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    expect(screen.queryByRole('menuitem', { name: '实例文件' })).not.toBeInTheDocument();
  });

  it('does not render logout menu item in private deployment mode', async () => {
    renderMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    expect(screen.queryByRole('menuitem', { name: '退出登录' })).not.toBeInTheDocument();
  });
});
