import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    mockLogout.mockClear();
    mockAddToast.mockClear();
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

  it('opens instance list modal from instance menu item', async () => {
    renderMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '实例' }));
    });
    expect(screen.getByText('实例列表弹窗')).toBeInTheDocument();
  });

  it('does not render instance files menu item in account dropdown', async () => {
    renderMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    expect(screen.queryByRole('menuitem', { name: '实例文件' })).not.toBeInTheDocument();
  });

  it('confirms before logout and skips logout when cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
    });

    expect(confirmSpy).toHaveBeenCalledWith('确认退出登录吗？');
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('logs out after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开账户菜单' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
    });

    expect(confirmSpy).toHaveBeenCalledWith('确认退出登录吗？');
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockAddToast).toHaveBeenCalledWith('已退出登录', 'success');
  });
});
