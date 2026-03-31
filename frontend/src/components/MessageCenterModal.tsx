import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { listUserMessages, readUserMessage } from '../api/messageClient';
import type { UserMessageItem, UserMessageLinkItem } from '../api/types';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';

type MessageCenterModalProps = {
  open: boolean;
  onClose: () => void;
};

type MessageViewItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  status: 'unread' | 'read';
  links: UserMessageLinkItem[];
};

export function MessageCenterModal({ open, onClose }: MessageCenterModalProps): JSX.Element | null {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageViewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedMessage = useMemo(
    () => messages.find((item) => item.id === selectedId) ?? null,
    [messages, selectedId]
  );

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    setErrorText(null);
    try {
      const result = await listUserMessages();
      const normalized = result.map(normalizeMessage).sort((left, right) => {
        const leftTs = Date.parse(left.createdAt);
        const rightTs = Date.parse(right.createdAt);
        return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
      });
      setMessages(normalized);
      setSelectedId((current) => {
        if (current && normalized.some((item) => item.id === current)) {
          return current;
        }
        return normalized[0]?.id ?? null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取消息失败';
      setErrorText(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markRead = useCallback(
    async (messageId: string) => {
      const target = messages.find((item) => item.id === messageId);
      if (!target || target.status === 'read' || isReading) {
        return;
      }
      setIsReading(true);
      try {
        await readUserMessage(messageId);
        setMessages((current) =>
          current.map((item) => (item.id === messageId ? { ...item, status: 'read' } : item))
        );
      } catch (error) {
        addToast(error instanceof Error ? error.message : '标记已读失败', 'error');
      } finally {
        setIsReading(false);
      }
    },
    [addToast, isReading, messages]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadMessages();
  }, [loadMessages, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !selectedMessage) {
      return;
    }
    void markRead(selectedMessage.id);
  }, [markRead, open, selectedMessage]);

  const handleSelectMessage = useCallback((messageId: string) => {
    setSelectedId(messageId);
  }, []);

  if (!open) {
    return null;
  }

  const modal = (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="消息中心">
      <div style={backdropStyle} onClick={onClose} aria-hidden="true" />
      <section style={getPanelStyle(isMobile)}>
        <header style={headerStyle}>
          <div>
            <h2 style={titleStyle}>消息中心</h2>
            <p style={subtitleStyle}>系统通知与回执确认入口</p>
          </div>
          <div style={headerActionsStyle}>
            <button type="button" style={ghostButtonStyle} onClick={() => void loadMessages()} disabled={isLoading}>
              刷新
            </button>
            <button type="button" style={closeButtonStyle} onClick={onClose} aria-label="关闭消息中心">
              ×
            </button>
          </div>
        </header>

        <div style={getBodyStyle(isMobile)}>
          <aside style={getListPaneStyle(isMobile)}>
            {isLoading ? <p style={hintStyle}>正在加载消息...</p> : null}
            {!isLoading && errorText ? <p style={errorStyle}>{errorText}</p> : null}
            {!isLoading && !errorText && messages.length === 0 ? <p style={hintStyle}>暂无消息</p> : null}
            {!isLoading && !errorText
              ? messages.map((message) => {
                  const isActive = message.id === selectedId;
                  return (
                    <button
                      key={message.id}
                      type="button"
                      style={getMessageItemStyle(isActive, message.status === 'unread')}
                      onClick={() => handleSelectMessage(message.id)}
                    >
                      <div style={messageTitleRowStyle}>
                        <span style={messageTitleStyle}>{message.title}</span>
                        {message.status === 'unread' ? <span style={unreadDotStyle} aria-label="未读" /> : null}
                      </div>
                      <span style={messageMetaStyle}>{formatMessageTime(message.createdAt)}</span>
                    </button>
                  );
                })
              : null}
          </aside>

          <article style={detailPaneStyle}>
            {selectedMessage ? (
              <>
                <h3 style={detailTitleStyle}>{selectedMessage.title}</h3>
                <p style={detailMetaStyle}>
                  {formatMessageTime(selectedMessage.createdAt)} · {selectedMessage.status === 'unread' ? '未读' : '已读'}
                </p>
                <p style={detailBodyStyle}>{selectedMessage.body}</p>
                {selectedMessage.links.length > 0 ? (
                  <div style={linkGroupStyle}>
                    {selectedMessage.links.map((link, index) => (
                      <a key={`${link.href}-${index}`} href={link.href} style={linkStyle}>
                        {link.label?.trim() || '打开链接'}
                      </a>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p style={hintStyle}>请选择左侧消息查看详情</p>
            )}
          </article>
        </div>
      </section>
    </div>
  );

  if (typeof document === 'undefined' || !document.body) {
    return modal;
  }

  return createPortal(modal, document.body);
}

function normalizeMessage(raw: UserMessageItem): MessageViewItem {
  const candidate = raw as Partial<UserMessageItem> & {
    message?: string | null;
    content?: string | null;
    timestamp?: string | null;
    url?: string | null;
  };

  const title = String(candidate.title ?? '').trim() || '系统消息';
  const body = String(candidate.body ?? candidate.message ?? candidate.content ?? '').trim() || '暂无正文';
  const createdAt = String(candidate.created_at ?? candidate.timestamp ?? '').trim() || new Date().toISOString();
  const status = candidate.is_read === true || String(candidate.status ?? '').toLowerCase() === 'read' ? 'read' : 'unread';

  const links = new Map<string, UserMessageLinkItem>();
  const rawLinks = Array.isArray(candidate.links) ? candidate.links : [];
  for (const item of rawLinks) {
    if (!item || typeof item.href !== 'string') {
      continue;
    }
    const href = item.href.trim();
    if (!href) {
      continue;
    }
    links.set(href, {
      href,
      label: typeof item.label === 'string' ? item.label : null,
    });
  }

  const actionUrl = String(candidate.confirmation_url ?? candidate.action_url ?? candidate.url ?? '').trim();
  if (actionUrl) {
    links.set(actionUrl, {
      href: actionUrl,
      label: typeof candidate.action_label === 'string' ? candidate.action_label : '打开回执链接',
    });
  }

  return {
    id: String(candidate.id ?? ''),
    title,
    body,
    createdAt,
    status,
    links: [...links.values()],
  };
}

function formatMessageTime(raw: string): string {
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return raw;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 220,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  pointerEvents: 'auto',
  paddingTop: '56px',
};

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.24)',
  zIndex: 0,
  pointerEvents: 'auto',
};

function getPanelStyle(isMobile: boolean): React.CSSProperties {
  return {
    position: 'relative',
    zIndex: 1,
    width: isMobile ? '100%' : 'min(980px, calc(100% - 1.2rem))',
    height: isMobile ? 'calc(100% - 0.4rem)' : 'min(620px, calc(100% - 1rem))',
    margin: isMobile ? '0.2rem 0.2rem 0' : '0.5rem 0',
    background: 'rgba(255, 255, 255, 0.97)',
    border: '1px solid rgba(148, 163, 184, 0.38)',
    borderRadius: isMobile ? '0.75rem 0.75rem 0 0' : '0.9rem',
    boxShadow: '0 28px 60px -36px rgba(15, 23, 42, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    pointerEvents: 'auto',
  };
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(148, 163, 184, 0.34)',
  padding: '0.8rem 0.9rem',
  gap: '0.8rem',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  color: '#0f172a',
};

const subtitleStyle: React.CSSProperties = {
  margin: '0.25rem 0 0',
  fontSize: '0.76rem',
  color: '#64748b',
};

const headerActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
};

const ghostButtonStyle: React.CSSProperties = {
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  borderRadius: '0.45rem',
  color: '#334155',
  fontSize: '0.76rem',
  padding: '0.35rem 0.55rem',
  cursor: 'pointer',
};

const closeButtonStyle: React.CSSProperties = {
  border: '1px solid #cbd5e1',
  background: '#fff',
  borderRadius: '0.45rem',
  color: '#334155',
  fontSize: '1rem',
  lineHeight: 1,
  width: '1.85rem',
  height: '1.85rem',
  cursor: 'pointer',
};

function getBodyStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'minmax(230px, 280px) 1fr',
    flex: 1,
    minHeight: 0,
  };
}

function getListPaneStyle(isMobile: boolean): React.CSSProperties {
  return {
    borderRight: isMobile ? 'none' : '1px solid rgba(148, 163, 184, 0.3)',
    borderBottom: isMobile ? '1px solid rgba(148, 163, 184, 0.3)' : 'none',
    padding: '0.5rem',
    overflowY: 'auto',
    maxHeight: isMobile ? '36vh' : 'none',
    background: 'rgba(248, 250, 252, 0.75)',
  };
}

const detailPaneStyle: React.CSSProperties = {
  padding: '0.9rem',
  overflowY: 'auto',
  minHeight: 0,
};

function getMessageItemStyle(isActive: boolean, isUnread: boolean): React.CSSProperties {
  return {
    width: '100%',
    textAlign: 'left',
    border: isActive ? '1px solid rgba(15, 118, 110, 0.55)' : '1px solid rgba(203, 213, 225, 0.72)',
    background: isActive ? 'rgba(236, 253, 245, 0.8)' : '#fff',
    borderRadius: '0.55rem',
    padding: '0.58rem',
    marginBottom: '0.4rem',
    cursor: 'pointer',
    boxShadow: isUnread ? 'inset 2px 0 0 #10b981' : 'none',
  };
}

const messageTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

const messageTitleStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  fontWeight: 600,
  color: '#1e293b',
};

const unreadDotStyle: React.CSSProperties = {
  width: '0.45rem',
  height: '0.45rem',
  borderRadius: '999px',
  background: '#10b981',
  flexShrink: 0,
};

const messageMetaStyle: React.CSSProperties = {
  marginTop: '0.3rem',
  display: 'block',
  fontSize: '0.72rem',
  color: '#64748b',
};

const detailTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  color: '#0f172a',
};

const detailMetaStyle: React.CSSProperties = {
  margin: '0.35rem 0 0.9rem',
  color: '#64748b',
  fontSize: '0.74rem',
};

const detailBodyStyle: React.CSSProperties = {
  margin: 0,
  color: '#1f2937',
  fontSize: '0.86rem',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const linkGroupStyle: React.CSSProperties = {
  marginTop: '0.9rem',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.48rem',
};

const linkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
  border: '1px solid #cbd5e1',
  borderRadius: '0.45rem',
  background: '#f8fafc',
  color: '#0f766e',
  fontSize: '0.78rem',
  fontWeight: 600,
  padding: '0.38rem 0.56rem',
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#64748b',
  padding: '0.4rem',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#b91c1c',
  padding: '0.4rem',
};
