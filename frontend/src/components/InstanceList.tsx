import type React from 'react';
import type { InstanceItem } from '../api/types';

interface InstanceListProps {
  instances: InstanceItem[];
  loading: boolean;
  error: string | null;
  selectedInstanceId: string | null;
  onSelectInstance: (instanceId: string) => void;
}

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return '未知';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '未知';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  return date.toLocaleDateString('zh-CN');
}

function getStatusDotColor(status: string): string {
  switch (status) {
    case 'connected':
      return '#22c55e';
    case 'disconnected':
      return '#ef4444';
    case 'pending':
      return '#f59e0b';
    default:
      return '#6b7280';
  }
}

export function InstanceList({
  instances,
  loading,
  error,
  selectedInstanceId,
  onSelectInstance,
}: InstanceListProps): JSX.Element {
  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={loadingStyle}>加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={errorStyle}>{error}</div>
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={emptyStyle}>暂无实例</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={listStyle}>
        {instances.map((instance) => {
          const isSelected = instance.id === selectedInstanceId;
          return (
            <button
              key={instance.id}
              type="button"
              style={getItemStyle(isSelected)}
              onClick={() => onSelectInstance(instance.id)}
            >
              <div style={itemHeaderStyle}>
                <span
                  style={getStatusDotStyle(instance.status)}
                  title={`状态: ${instance.status}`}
                />
                <span style={itemNameStyle}>{instance.name}</span>
              </div>
              <span style={itemTimeStyle}>
                {formatRelativeTime(instance.last_check_at)}
              </span>
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

const loadingStyle: React.CSSProperties = {
  padding: '1rem',
  textAlign: 'center',
  color: '#6b7280',
  fontSize: '0.875rem',
};

const errorStyle: React.CSSProperties = {
  padding: '1rem',
  textAlign: 'center',
  color: '#dc2626',
  fontSize: '0.875rem',
};

const emptyStyle: React.CSSProperties = {
  padding: '1rem',
  textAlign: 'center',
  color: '#9ca3af',
  fontSize: '0.875rem',
};

function getItemStyle(isSelected: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    padding: '0.75rem',
    border: 'none',
    borderRadius: '0.375rem',
    background: isSelected ? '#eff6ff' : 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    transition: 'background-color 0.15s ease',
  };
}

const itemHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
};

function getStatusDotStyle(status: string): React.CSSProperties {
  return {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: getStatusDotColor(status),
    flexShrink: 0,
  };
}

const itemNameStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#1f2933',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const itemTimeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
  paddingLeft: '1rem',
};

export default InstanceList;
