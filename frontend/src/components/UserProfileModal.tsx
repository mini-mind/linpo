import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { updatePassword, updateProfile, type User } from '../api/authClient';
import { useAuth } from '../hooks/useAuth';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';

type UserProfileModalProps = {
  open: boolean;
  user: User | null;
  onClose: () => void;
};

type AccountTab = 'basic' | 'password' | 'membership';

export function UserProfileModal({ open, user, onClose }: UserProfileModalProps): JSX.Element | null {
  const isMobile = useIsMobile(960);
  const { refresh } = useAuth();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<AccountTab>('basic');
  const [usernameInput, setUsernameInput] = useState('');
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUsernameInput(user?.username ?? '');
  }, [user?.username]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  const handleSaveUsername = useCallback(async () => {
    if (isSavingUsername) {
      return;
    }
    const nextUsername = usernameInput.trim();
    if (nextUsername === '') {
      addToast('用户名不能为空', 'warning');
      return;
    }
    if (nextUsername === (user?.username ?? '')) {
      setIsEditingUsername(false);
      return;
    }
    setIsSavingUsername(true);
    try {
      await updateProfile({ username: nextUsername });
      await refresh();
      setIsEditingUsername(false);
      addToast('用户名已更新', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '用户名更新失败';
      addToast(message, 'error');
    } finally {
      setIsSavingUsername(false);
    }
  }, [addToast, isSavingUsername, refresh, user?.username, usernameInput]);

  const handleAvatarFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.currentTarget.value = '';
      if (!file) {
        return;
      }
      if (!file.type.startsWith('image/')) {
        addToast('请选择图片文件', 'warning');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        addToast('头像大小需小于 2MB', 'warning');
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const result = typeof reader.result === 'string' ? reader.result : null;
        if (!result) {
          addToast('头像读取失败，请重试', 'error');
          return;
        }
        setIsSavingAvatar(true);
        try {
          await updateProfile({ avatar_url: result });
          await refresh();
          addToast('头像已更新', 'success');
        } catch (error) {
          const message = error instanceof Error ? error.message : '头像更新失败';
          addToast(message, 'error');
        } finally {
          setIsSavingAvatar(false);
        }
      };
      reader.onerror = () => {
        addToast('头像读取失败，请重试', 'error');
      };
      reader.readAsDataURL(file);
    },
    [addToast, refresh]
  );

  const handleSubmitPassword = useCallback(async () => {
    if (isSavingPassword) {
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      addToast('请填写完整密码信息', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      addToast('两次输入的新密码不一致', 'warning');
      return;
    }
    if (newPassword.length < 6) {
      addToast('新密码长度至少 6 位', 'warning');
      return;
    }

    setIsSavingPassword(true);
    try {
      await updatePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setActiveTab('basic');
      addToast('密码已更新', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '密码更新失败';
      addToast(message, 'error');
    } finally {
      setIsSavingPassword(false);
    }
  }, [addToast, confirmPassword, currentPassword, isSavingPassword, newPassword]);

  if (!open) {
    return null;
  }

  const modal = (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="账户">
      <div style={backdropStyle} onClick={onClose} aria-hidden="true" />
      <section style={panelStyle}>
        <header style={headerStyle}>
          <h3 style={titleStyle}>账户</h3>
          <button type="button" style={closeButtonStyle} onClick={onClose} aria-label="关闭账户">
            ×
          </button>
        </header>

        <div style={isMobile ? contentMobileStyle : contentStyle}>
          <aside style={isMobile ? tabsMobileStyle : tabsStyle} aria-label="账户导航">
            <button
              type="button"
              style={{ ...tabButtonStyle, ...(activeTab === 'basic' ? tabButtonActiveStyle : null) }}
              onClick={() => setActiveTab('basic')}
            >
              基本信息
            </button>
            <button
              type="button"
              style={{ ...tabButtonStyle, ...(activeTab === 'password' ? tabButtonActiveStyle : null) }}
              onClick={() => setActiveTab('password')}
            >
              修改密码
            </button>
            <button
              type="button"
              style={{ ...tabButtonStyle, ...(activeTab === 'membership' ? tabButtonActiveStyle : null) }}
              onClick={() => setActiveTab('membership')}
            >
              会员
            </button>
          </aside>

          <div style={panelBodyStyle}>
            {activeTab === 'basic' ? (
              <div style={sectionCardStyle}>
                <div style={profileMetaStyle}>
                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>头像</span>
                    <div style={fieldValueRowStyle}>
                      <div style={avatarInlineShellStyle}>
                        {user?.avatar_url ? (
                          <img src={user.avatar_url} alt="用户头像" style={avatarStyle} />
                        ) : (
                          <span style={avatarTextStyle}>{getAvatarText(user?.username)}</span>
                        )}
                      </div>
                      <span style={avatarHintStyle}>{user?.avatar_url ? '已设置' : '使用昵称首字母'}</span>
                      <button
                        type="button"
                        style={textActionButtonStyle}
                        disabled={isSavingAvatar}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {isSavingAvatar ? '上传中...' : '换头像'}
                      </button>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarFileChange}
                        style={hiddenInputStyle}
                        disabled={isSavingAvatar}
                      />
                    </div>
                  </div>
                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>用户名</span>
                    <div style={fieldValueRowStyle}>
                      {!isEditingUsername ? (
                        <>
                          <p style={nameStyle}>{user?.username ?? '--'}</p>
                          <button
                            type="button"
                            style={textActionButtonStyle}
                            onClick={() => setIsEditingUsername(true)}
                            title="换用户名"
                          >
                            换用户名
                          </button>
                        </>
                      ) : (
                        <>
                          <input
                            value={usernameInput}
                            onChange={(event) => setUsernameInput(event.target.value)}
                            style={usernameInputStyle}
                            disabled={isSavingUsername}
                            autoFocus
                          />
                          <button
                            type="button"
                            style={textActionButtonStyle}
                            onClick={() => void handleSaveUsername()}
                            title="保存用户名"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            style={textSecondaryButtonStyle}
                            onClick={() => {
                              setUsernameInput(user?.username ?? '');
                              setIsEditingUsername(false);
                            }}
                            title="取消编辑"
                          >
                            取消
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>邮箱</span>
                    <div style={fieldValueRowStyle}>
                      <p style={emailStyle}>{user?.email ?? '--'}</p>
                      <button
                        type="button"
                        style={textSecondaryButtonStyle}
                        onClick={() => setActiveTab('password')}
                        title="去修改密码"
                      >
                        修改密码
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === 'password' ? (
              <div style={sectionCardStyle}>
                <label style={inputLabelStyle}>
                  当前密码
                  <input
                    type="password"
                    style={inputStyle}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    disabled={isSavingPassword}
                  />
                </label>
                <label style={inputLabelStyle}>
                  新密码
                  <input
                    type="password"
                    style={inputStyle}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={isSavingPassword}
                  />
                </label>
                <label style={inputLabelStyle}>
                  确认新密码
                  <input
                    type="password"
                    style={inputStyle}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={isSavingPassword}
                  />
                </label>
                <div style={passwordActionRowStyle}>
                  <button type="button" style={smallActionButtonStyle} onClick={() => void handleSubmitPassword()} disabled={isSavingPassword}>
                    {isSavingPassword ? '更新中...' : '保存密码'}
                  </button>
                </div>
              </div>
            ) : null}

            {activeTab === 'membership' ? (
              <div style={sectionCardStyle}>
                <h4 style={membershipTitleStyle}>会员充值</h4>
                <p style={membershipHintStyle}>支付通道建设中，暂未开通</p>
                <div style={channelGridStyle}>
                  <div style={channelItemStyle}>
                    <span style={channelNameStyle}>支付宝</span>
                    <span style={channelStatusStyle}>未开通</span>
                  </div>
                  <div style={channelItemStyle}>
                    <span style={channelNameStyle}>PayPal</span>
                    <span style={channelStatusStyle}>未开通</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );

  if (typeof document === 'undefined' || !document.body) {
    return modal;
  }
  return createPortal(modal, document.body);
}

function getAvatarText(username: string | null | undefined): string {
  const normalized = username?.trim() ?? '';
  if (!normalized) {
    return 'U';
  }
  if (/^[\u3400-\u9fff]/.test(normalized)) {
    return normalized.charAt(0);
  }
  return normalized.slice(0, 2).toUpperCase();
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 240,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '56px',
};

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.26)',
};

const panelStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: 'min(720px, calc(100% - 1.2rem))',
  borderRadius: '0.85rem',
  border: '1px solid rgba(148, 163, 184, 0.38)',
  background: 'rgba(255, 255, 255, 0.97)',
  boxShadow: '0 28px 60px -36px rgba(15, 23, 42, 0.48)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 0.9rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.3)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  color: '#0f172a',
  fontWeight: 700,
};

const closeButtonStyle: React.CSSProperties = {
  width: '1.85rem',
  height: '1.85rem',
  borderRadius: '0.45rem',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: '#fff',
  color: '#334155',
  cursor: 'pointer',
  fontSize: '1rem',
  lineHeight: 1,
};

const contentStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '170px minmax(0, 1fr)',
  minHeight: '360px',
};

const contentMobileStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '360px',
};

const tabsStyle: React.CSSProperties = {
  borderRight: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(248, 250, 252, 0.82)',
  padding: '0.6rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
};

const tabsMobileStyle: React.CSSProperties = {
  borderBottom: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(248, 250, 252, 0.82)',
  padding: '0.5rem',
  display: 'flex',
  flexDirection: 'row',
  gap: '0.35rem',
};

const tabButtonStyle: React.CSSProperties = {
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(148, 163, 184, 0.4)',
  borderRadius: '0.5rem',
  background: '#fff',
  color: '#334155',
  fontSize: '0.78rem',
  fontWeight: 600,
  padding: '0.45rem 0.56rem',
  textAlign: 'left',
  cursor: 'pointer',
};

const tabButtonActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(15, 118, 110, 0.45)',
  background: 'rgba(236, 253, 245, 0.9)',
  color: '#0f766e',
};

const panelBodyStyle: React.CSSProperties = {
  padding: '0.85rem',
  minWidth: 0,
};

const sectionCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '0.72rem',
  background: 'rgba(255, 255, 255, 0.95)',
  padding: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

const avatarShellStyle: React.CSSProperties = {
  width: '4rem',
  height: '4rem',
  borderRadius: '999px',
  overflow: 'hidden',
  border: '1px solid rgba(56, 189, 248, 0.36)',
  background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.24), rgba(14, 165, 233, 0.24))',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const avatarStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const avatarTextStyle: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 700,
  color: '#0f172a',
};

const avatarInlineShellStyle: React.CSSProperties = {
  ...avatarShellStyle,
  width: '2rem',
  height: '2rem',
};

const avatarHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#64748b',
  flex: 1,
};

const profileMetaStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.34rem',
  minWidth: 0,
  width: '100%',
};

const fieldRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '4rem minmax(0, 1fr)',
  alignItems: 'center',
  gap: '0.5rem',
  minWidth: 0,
};

const fieldLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  fontWeight: 600,
  color: '#64748b',
};

const fieldValueRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  minWidth: 0,
};

const nameStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  fontWeight: 700,
  color: '#0f172a',
  minWidth: 0,
  flex: 1,
};

const emailStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#475569',
  wordBreak: 'break-all',
  minWidth: 0,
  flex: 1,
};

const textActionButtonStyle: React.CSSProperties = {
  height: '1.9rem',
  borderRadius: '0.45rem',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: '#fff',
  color: '#334155',
  cursor: 'pointer',
  fontSize: '0.74rem',
  fontWeight: 600,
  padding: '0 0.56rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const textSecondaryButtonStyle: React.CSSProperties = {
  ...textActionButtonStyle,
  color: '#475569',
  background: 'rgba(248, 250, 252, 0.9)',
};

const usernameInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: '1px solid rgba(148, 163, 184, 0.4)',
  borderRadius: '0.45rem',
  padding: '0.34rem 0.5rem',
  fontSize: '0.8rem',
  color: '#0f172a',
};

const hiddenInputStyle: React.CSSProperties = {
  display: 'none',
};

const inputLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.26rem',
  fontSize: '0.76rem',
  color: '#334155',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.4)',
  borderRadius: '0.5rem',
  padding: '0.44rem 0.58rem',
  fontSize: '0.8rem',
  color: '#0f172a',
};

const smallActionButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.45)',
  background: '#fff',
  borderRadius: '0.45rem',
  color: '#334155',
  fontSize: '0.74rem',
  fontWeight: 600,
  padding: '0.34rem 0.52rem',
  cursor: 'pointer',
};

const passwordActionRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const membershipTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.86rem',
  fontWeight: 700,
  color: '#0f172a',
};

const membershipHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#64748b',
};

const channelGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '0.5rem',
};

const channelItemStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '0.58rem',
  background: 'rgba(248, 250, 252, 0.95)',
  padding: '0.52rem 0.58rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const channelNameStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#0f172a',
  fontWeight: 600,
};

const channelStatusStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#64748b',
};
