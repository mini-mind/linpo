import type React from 'react';
import { useEffect, useState } from 'react';
import { listAgents } from '../api/client';
import type { AgentListItem, AgentStatus } from '../api/types';
import { STATUS_DOT_COLORS } from '../utils/statusStyles';

interface InstanceListProps {
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
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

export function InstanceList({ selectedAgentId, onSelectAgent }: InstanceListProps): JSX.Element {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAgents(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const agentList = await listAgents();
        if (!cancelled) {
          setAgents(agentList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '获取实例列表失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchAgents();
    return () => { cancelled = true; };
  }, []);

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

  if (agents.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={emptyStyle}>暂无实例</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={listStyle}>
        {agents.map((agent) => {
          const isSelected = agent.id === selectedAgentId;
          return (
            <button
              key={agent.id}
              type="button"
              style={getItemStyle(isSelected)}
              onClick={() => onSelectAgent(agent.id)}
            >
              <div style={itemHeaderStyle}>
                <span
                  style={getStatusDotStyle(agent.status)}
                  title={`状态: ${agent.status}`}
                />
                <span style={itemNameStyle}>{agent.name}</span>
              </div>
              <span style={itemTimeStyle}>
                {formatRelativeTime(agent.last_active_at)}
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

function getStatusDotStyle(status: AgentStatus): React.CSSProperties {
  return {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: STATUS_DOT_COLORS[status] ?? STATUS_DOT_COLORS.idle,
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
