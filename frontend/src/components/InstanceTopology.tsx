import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDefaultObserverDataSource, listAgents } from '../api/client';
import {
  createObserverRealtimeClient,
  type ObserverRealtimeClient,
  type ObserverRealtimeClientOptions,
} from '../api/realtimeClient';
import type { AgentListItem } from '../api/types';
import { useIsMobile } from '../hooks/useIsMobile';

type AgentsUpdate = AgentListItem[] | ((previous: AgentListItem[]) => AgentListItem[]);

interface StartAgentsListRealtimeOptions {
  listAgentsFn: () => Promise<AgentListItem[]>;
  createRealtimeClientFn: (options: ObserverRealtimeClientOptions) => ObserverRealtimeClient;
  applyAgents: (update: AgentsUpdate) => void;
}

const AGENTS_LIST_REALTIME_DATA_SOURCE = getDefaultObserverDataSource();

function withErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function mergeAgentSummary(
  previousAgents: AgentListItem[],
  updatedAgent: AgentListItem
): AgentListItem[] {
  const targetIndex = previousAgents.findIndex((agent) => agent.id === updatedAgent.id);
  if (targetIndex < 0) {
    return [...previousAgents, updatedAgent];
  }

  return previousAgents.map((agent, index) => (index === targetIndex ? updatedAgent : agent));
}

async function startAgentsListRealtime(
  options: StartAgentsListRealtimeOptions
): Promise<{ close: () => void } | null> {
  const snapshot = await options.listAgentsFn();
  options.applyAgents(snapshot);

  const runResync = async (): Promise<void> => {
    try {
      const refreshed = await options.listAgentsFn();
      options.applyAgents(refreshed);
    } catch { }
  };

  try {
    const realtimeClient = options.createRealtimeClientFn({
      dataSource: AGENTS_LIST_REALTIME_DATA_SOURCE,
      channel: 'agents:list',
      onMessage: (message) => {
        if (message.type === 'agent_summary_updated') {
          options.applyAgents((previousAgents) =>
            mergeAgentSummary(previousAgents, message.payload.agent)
          );
        }
      },
      onResyncRequired: () => {
        void runResync();
      },
    });

    realtimeClient.connect();
    return realtimeClient;
  } catch {
    return null;
  }
}

function formatLastActive(isoString: string | null): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '未知';
  }
}

export function InstanceTopology(): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentListItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    let realtimeHandle: { close: () => void } | null = null;

    async function loadSnapshotAndSubscribe() {
      try {
        const handle = await startAgentsListRealtime({
          listAgentsFn: listAgents,
          createRealtimeClientFn: createObserverRealtimeClient,
          applyAgents: (update) => {
            if (cancelled) {
              return;
            }
            setAgents((previousAgents) =>
              typeof update === 'function' ? update(previousAgents) : update
            );
          },
        });

        if (!cancelled) {
          realtimeHandle = handle;
        } else {
          handle?.close();
        }
      } catch (err) {
        if (!cancelled) {
          const message = withErrorMessage(err, '获取实例列表失败');
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSnapshotAndSubscribe();

    return () => {
      cancelled = true;
      realtimeHandle?.close();
    };
  }, []);

  const handleInstanceClick = (agent: AgentListItem): void => {
    setSelectedAgent(agent);
  };

  const handleCloseModal = (): void => {
    setSelectedAgent(null);
  };

  const handleGoToSession = (): void => {
    if (selectedAgent) {
      navigate(`/session/${selectedAgent.id}`);
      setSelectedAgent(null);
    }
  };

  if (loading) {
    return (
      <div style={getContainerStyle(isMobile)}>
        <p style={textStyle}>加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={getContainerStyle(isMobile)}>
        <p style={errorStyle}>错误: {error}</p>
      </div>
    );
  }

  return (
    <div style={getContainerStyle(isMobile)}>
      <div style={getCanvasStyle(isMobile)}>
        {agents.length === 0 ? (
          <div style={emptyStyle}>
            <p style={emptyTextStyle}>暂无实例</p>
            <p style={emptyHintStyle}>添加实例开始使用</p>
          </div>
        ) : (
          <div style={topologyContainerStyle}>
            {agents.map((agent, index) => (
              <button
                key={agent.id}
                type="button"
                style={getInstanceNodeStyle(agent.status, agent.is_active, isMobile)}
                onClick={() => handleInstanceClick(agent)}
              >
                <div style={nodeIconStyle}>
                  <InstanceIcon status={agent.status} isActive={agent.is_active} size={isMobile ? 32 : 40} />
                  {agent.is_active && <div style={healthPulseStyle} />}
                </div>
                <div style={nodeInfoStyle}>
                  <span style={getNodeNameStyle(isMobile)}>{agent.name}</span>
                  <div style={nodeBadgesStyle}>
                    <span style={nodeStatusStyle}>
                      {agent.status === 'running' ? '运行中' : agent.status === 'idle' ? '空闲' : agent.status}
                    </span>
                    <span style={agent.is_active ? nodeActiveStyle : nodeInactiveStyle}>
                      {agent.is_active ? '● 活跃' : '○ 不活跃'}
                    </span>
                  </div>
                </div>
                {index < agents.length - 1 && !isMobile && (
                  <svg style={connectionLineStyle} aria-hidden="true">
                    <title>连接线</title>
                    <line
                      x1="50%"
                      y1="100%"
                      x2="50%"
                      y2="150%"
                      stroke="#d1d5db"
                      strokeWidth="2"
                      strokeDasharray="5,5"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedAgent && (
        <div
          style={modalOverlayStyle}
          onClick={handleCloseModal}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleCloseModal();
          }}
          role="button"
          tabIndex={0}
        >
          {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
          <div
            style={getModalStyle(isMobile)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={() => {}}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div style={modalHeaderStyle}>
              <h2 style={modalTitleStyle}>{selectedAgent.name}</h2>
              <button
                type="button"
                style={closeButtonStyle}
                onClick={handleCloseModal}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div style={modalBodyStyle}>
              <div style={infoRowStyle}>
                <span style={infoLabelStyle}>实例 ID</span>
                <span style={infoValueStyle}>{selectedAgent.id}</span>
              </div>
              <div style={infoRowStyle}>
                <span style={infoLabelStyle}>运行状态</span>
                <span style={getInfoValueWithStatusStyle(selectedAgent.status)}>
                  {selectedAgent.status === 'running' ? '运行中' : selectedAgent.status === 'idle' ? '空闲' : selectedAgent.status}
                </span>
              </div>
              <div style={infoRowStyle}>
                <span style={infoLabelStyle}>活跃状态</span>
                <span style={selectedAgent.is_active ? activeInfoStyle : inactiveInfoStyle}>
                  {selectedAgent.is_active ? '● 活跃' : '○ 不活跃'}
                </span>
              </div>
              <div style={infoRowStyle}>
                <span style={infoLabelStyle}>最后活跃</span>
                <span style={infoValueStyle}>{formatLastActive(selectedAgent.last_active_at)}</span>
              </div>
            </div>
            <div style={modalFooterStyle}>
              <button
                type="button"
                style={sessionButtonStyle}
                onClick={handleGoToSession}
              >
                进入会话
              </button>
            </div>
          </div>
        </div>
      )}

      <button type="button" disabled style={getFabStyle(isMobile)} title="添加实例">
        +
      </button>
    </div>
  );
}

function InstanceIcon({ status, isActive, size }: { status: string; isActive: boolean; size: number }): JSX.Element {
  const color = isActive ? '#10b981' : status === 'running' ? '#3b82f6' : '#9ca3af';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" aria-label="实例图标">
      <title>实例</title>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function getContainerStyle(isMobile: boolean): React.CSSProperties {
  return {
    height: '100%',
    padding: isMobile ? '1rem' : '2rem',
    background: '#f4f1ea',
    color: '#1f2933',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    overflow: 'auto',
    boxSizing: 'border-box',
  };
}

function getCanvasStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'center',
    alignItems: isMobile ? 'stretch' : 'flex-start',
    minHeight: isMobile ? '40vh' : '60vh',
    padding: isMobile ? '0.5rem' : '2rem',
  };
}

function getInstanceNodeStyle(status: string, isActive: boolean, isMobile: boolean): React.CSSProperties {
  const borderColor = isActive ? '#10b981' : status === 'running' ? '#3b82f6' : '#d1d5db';
  const shadow = isActive ? '0 0 0 3px rgba(16, 185, 129, 0.1)' : 'none';

  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: isMobile ? '1rem' : '1.5rem 2rem',
    background: '#fff',
    border: `2px solid ${borderColor}`,
    borderRadius: isMobile ? '0.75rem' : '1rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: shadow,
    position: 'relative',
    marginBottom: isMobile ? '0.75rem' : '4rem',
    minWidth: isMobile ? 'unset' : '200px',
    width: isMobile ? '100%' : 'auto',
    maxWidth: isMobile ? '300px' : 'none',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: 'inherit',
  };
}

function getNodeNameStyle(isMobile: boolean): React.CSSProperties {
  return {
    fontSize: isMobile ? '1rem' : '1.125rem',
    fontWeight: 600,
    color: '#1f2933',
  };
}

const topologyContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0',
  width: '100%',
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2rem',
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: '1rem',
  color: '#6b7280',
  margin: 0,
};

const emptyHintStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#9ca3af',
  margin: '0.5rem 0 0 0',
  textAlign: 'center',
};

const textStyle: React.CSSProperties = {
  color: '#6b7280',
  textAlign: 'center',
  padding: '2rem',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  textAlign: 'center',
  padding: '2rem',
};

const nodeIconStyle: React.CSSProperties = {
  marginBottom: '0.5rem',
  position: 'relative',
};

const nodeInfoStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.25rem',
};

const nodeStatusStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#6b7280',
};

const nodeActiveStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#10b981',
};

const nodeInactiveStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
};

const nodeBadgesStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
};

const healthPulseStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '50px',
  height: '50px',
  borderRadius: '50%',
  background: 'rgba(16, 185, 129, 0.2)',
  animation: 'pulse 2s ease-in-out infinite',
};

const connectionLineStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '-4rem',
  left: '0',
  width: '100%',
  height: '4rem',
};

function getFabStyle(isMobile: boolean): React.CSSProperties {
  return {
    position: 'fixed',
    bottom: isMobile ? 'calc(56px + 1rem)' : '2rem',
    right: '1rem',
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: 'none',
    background: '#6b7280',
    color: '#fff',
    fontSize: '1.25rem',
    cursor: 'not-allowed',
    opacity: 0.5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 90,
  };
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
};

function getModalStyle(isMobile: boolean): React.CSSProperties {
  return {
    background: '#fff',
    borderRadius: '0.75rem',
    width: isMobile ? 'calc(100% - 2rem)' : '400px',
    maxWidth: '90%',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    overflow: 'hidden',
  };
}

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '1rem 1.25rem',
  borderBottom: '1px solid #e5e7eb',
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  color: '#1f2933',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '0.375rem',
  border: 'none',
  background: 'transparent',
  color: '#6b7280',
  fontSize: '1.5rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
};

const modalBodyStyle: React.CSSProperties = {
  padding: '1.25rem',
};

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.75rem 0',
  borderBottom: '1px solid #f3f4f6',
};

const infoLabelStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
};

const infoValueStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#1f2933',
  fontWeight: 500,
};

function getInfoValueWithStatusStyle(status: string): React.CSSProperties {
  return {
    fontSize: '0.875rem',
    color: status === 'running' ? '#10b981' : status === 'idle' ? '#6b7280' : '#1f2933',
    fontWeight: 500,
  };
}

const activeInfoStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#10b981',
  fontWeight: 500,
};

const inactiveInfoStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#9ca3af',
  fontWeight: 500,
};

const modalFooterStyle: React.CSSProperties = {
  padding: '1rem 1.25rem',
  borderTop: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'flex-end',
};

const sessionButtonStyle: React.CSSProperties = {
  padding: '0.625rem 1.25rem',
  background: '#3b82f6',
  color: '#fff',
  border: 'none',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.2s',
};