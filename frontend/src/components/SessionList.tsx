import type React from 'react';
import type { SessionListItem } from '../api/types';

interface SessionListProps {
  sessions: SessionListItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return '未知时间';

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '未知时间';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}

function getSessionTitle(session: SessionListItem): string {
  if (session.derived_title) {
    return session.derived_title;
  }
  if (session.label) {
    return session.label;
  }
  return '未命名会话';
}

function getKindLabel(kind: SessionListItem['kind']): string {
  const kindLabels: Record<SessionListItem['kind'], string> = {
    direct: '私聊',
    group: '群组',
    global: '全局',
    unknown: '未知',
  };
  return kindLabels[kind] ?? '未知';
}

export function SessionList({ sessions, selectedKey, onSelect }: SessionListProps): JSX.Element {
  if (sessions.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={emptyStyle}>暂无会话</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={listStyle}>
        {sessions.map((session) => {
          const isSelected = session.key === selectedKey;
          return (
            <button
              key={session.key}
              type="button"
              style={getItemStyle(isSelected)}
              onClick={() => onSelect(session.key)}
            >
              <div style={itemHeaderStyle}>
                <span style={getKindBadgeStyle(session.kind)}>
                  {getKindLabel(session.kind)}
                </span>
                <span style={getTitleStyle(isSelected)}>{getSessionTitle(session)}</span>
              </div>
              {session.last_message_preview && (
                <div style={previewStyle}>{session.last_message_preview}</div>
              )}
              <div style={timeStyle}>{formatRelativeTime(session.updated_at)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  padding: '0.5rem',
};

const emptyStyle: React.CSSProperties = {
  padding: '2rem 1rem',
  textAlign: 'center',
  color: '#9ca3af',
  fontSize: '0.875rem',
};

function getItemStyle(isSelected: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    padding: '0.75rem',
    border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
    borderRadius: '0.5rem',
    background: isSelected ? '#eff6ff' : 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    transition: 'all 0.15s ease',
  };
}

const itemHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  overflow: 'hidden',
};

function getKindBadgeStyle(kind: SessionListItem['kind']): React.CSSProperties {
  const kindColors: Record<SessionListItem['kind'], { bg: string; text: string }> = {
    direct: { bg: '#dbeafe', text: '#1e40af' },
    group: { bg: '#dcfce7', text: '#166534' },
    global: { bg: '#fef3c7', text: '#92400e' },
    unknown: { bg: '#f3f4f6', text: '#6b7280' },
  };
  const colors = kindColors[kind] ?? kindColors.unknown;

  return {
    flexShrink: 0,
    padding: '0.125rem 0.375rem',
    borderRadius: '0.25rem',
    fontSize: '0.625rem',
    fontWeight: 500,
    background: colors.bg,
    color: colors.text,
    textTransform: 'capitalize',
  };
}

function getTitleStyle(isSelected: boolean): React.CSSProperties {
  return {
    fontSize: '0.875rem',
    fontWeight: 500,
    color: isSelected ? '#1e40af' : '#1f2937',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

const previewStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#6b7280',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  paddingLeft: '0',
  lineHeight: '1.25',
};

const timeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
};

export default SessionList;
