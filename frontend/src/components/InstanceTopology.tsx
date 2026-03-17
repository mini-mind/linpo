import { useEffect, useState } from 'react';
import type React from 'react';
import { useNavigate } from 'react-router-dom';
import { getDefaultObserverDataSource, listAgents } from '../api/client';
import {
  createObserverRealtimeClient,
  type ObserverRealtimeClient,
  type ObserverRealtimeClientOptions,
} from '../api/realtimeClient';
import type { AgentListItem } from '../api/types';

type RealtimeStatus = 'realtime' | 'reconnecting' | 'resyncing' | 'disconnected' | 'error';

interface RealtimeState {
  status: RealtimeStatus;
  message: string | null;
}

type AgentsUpdate = AgentListItem[] | ((previous: AgentListItem[]) => AgentListItem[]);

interface StartAgentsListRealtimeOptions {
  listAgentsFn: () => Promise<AgentListItem[]>;
  createRealtimeClientFn: (options: ObserverRealtimeClientOptions) => ObserverRealtimeClient;
  applyAgents: (update: AgentsUpdate) => void;
  setRealtimeState: (state: RealtimeState) => void;
}

const AGENTS_LIST_REALTIME_DATA_SOURCE = getDefaultObserverDataSource();
const MOBILE_BREAKPOINT = 768;

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
  options.setRealtimeState({ status: 'reconnecting', message: null });

  const runResync = async (): Promise<void> => {
    options.setRealtimeState({ status: 'resyncing', message: null });
    try {
      const refreshed = await options.listAgentsFn();
      options.applyAgents(refreshed);
      options.setRealtimeState({ status: 'realtime', message: null });
    } catch (error) {
      options.setRealtimeState({
        status: 'error',
        message: withErrorMessage(error, '同步实例列表失败'),
      });
    }
  };

  try {
    const realtimeClient = options.createRealtimeClientFn({
      dataSource: AGENTS_LIST_REALTIME_DATA_SOURCE,
      channel: 'agents:list',
      onMessage: (message) => {
        if (message.type === 'snapshot_ready') {
          options.setRealtimeState({ status: 'realtime', message: null });
          return;
        }

        if (message.type === 'agent_summary_updated') {
          options.applyAgents((previousAgents) =>
            mergeAgentSummary(previousAgents, message.payload.agent)
          );
          options.setRealtimeState({ status: 'realtime', message: null });
          return;
        }

        if (message.type === 'error') {
          options.setRealtimeState({ status: 'error', message: message.payload.detail });
        }
      },
      onResyncRequired: () => {
        void runResync();
      },
      onParseError: (_raw, error) => {
        options.setRealtimeState({
          status: 'error',
          message: withErrorMessage(error, '解析实时消息失败'),
        });
      },
      onDisconnected: () => {
        options.setRealtimeState({
          status: 'disconnected',
          message: '实时连接意外断开',
        });
      },
    });

    realtimeClient.connect();
    return realtimeClient;
  } catch (error) {
    options.setRealtimeState({
      status: 'error',
      message: withErrorMessage(error, '连接实时通道失败'),
    });
    return null;
  }
}

const STATUS_LABELS: Record<RealtimeStatus, string> = {
  realtime: '已连接',
  reconnecting: '重连中',
  resyncing: '同步中',
  disconnected: '已断开',
  error: '错误',
};

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

export function InstanceTopology(): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>({
    status: 'reconnecting',
    message: null,
  });

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
          setRealtimeState: (state) => {
            if (!cancelled) {
              setRealtimeState(state);
            }
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
          setRealtimeState({ status: 'error', message });
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

  const handleInstanceClick = (agentId: string): void => {
    navigate(`/agents/${agentId}`);
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
      <div style={getHeaderStyle(isMobile)}>
        <h1 style={getTitleStyle(isMobile)}>灵盘</h1>
        <p style={getSubtitleStyle(isMobile)}>实例拓扑视图</p>
        <p style={metaStyle}>
          实时状态: {STATUS_LABELS[realtimeState.status]}
          {realtimeState.message ? ` - ${realtimeState.message}` : ''}
        </p>
      </div>

      <div style={getToolbarStyle(isMobile)}>
        <button type="button" disabled style={getDisabledButtonStyle(isMobile)}>
          添加实例
          <span style={tagStyle}>暂不支持</span>
        </button>
      </div>

      <div style={getCanvasStyle(isMobile)}>
        {agents.length === 0 ? (
          <div style={emptyStyle}>
            <p style={emptyTextStyle}>暂无实例</p>
            <p style={emptyHintStyle}>点击上方"添加实例"连接您的 OpenClaw 实例</p>
          </div>
        ) : (
          <div style={topologyContainerStyle}>
            {agents.map((agent, index) => (
              <button
                key={agent.id}
                type="button"
                style={getInstanceNodeStyle(agent.status, agent.is_active, isMobile)}
                onClick={() => handleInstanceClick(agent.id)}
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
                  <span style={healthBadgeStyle(agent.is_active, realtimeState.status)}>
                    {realtimeState.status === 'realtime' ? '已连接' : realtimeState.status === 'reconnecting' ? '重连中' : '离线'}
                  </span>
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
    minHeight: '100vh',
    padding: isMobile ? '1rem' : '2rem',
    background: '#f4f1ea',
    color: '#1f2933',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  };
}

function getHeaderStyle(isMobile: boolean): React.CSSProperties {
  return {
    marginBottom: isMobile ? '1rem' : '1.5rem',
    textAlign: 'center',
  };
}

function getTitleStyle(isMobile: boolean): React.CSSProperties {
  return {
    fontSize: isMobile ? '1.5rem' : '2rem',
    fontWeight: 700,
    margin: '0 0 0.25rem 0',
    color: '#1f2933',
  };
}

function getSubtitleStyle(isMobile: boolean): React.CSSProperties {
  return {
    fontSize: isMobile ? '0.875rem' : '1rem',
    color: '#6b7280',
    margin: 0,
  };
}

function getToolbarStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'center',
    gap: '1rem',
    marginBottom: isMobile ? '1rem' : '2rem',
  };
}

function getDisabledButtonStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: isMobile ? '0.375rem 0.75rem' : '0.5rem 1rem',
    fontSize: isMobile ? '0.75rem' : '0.875rem',
    borderRadius: '0.375rem',
    border: '1px solid #d1d5db',
    background: '#f9fafb',
    color: '#9ca3af',
    cursor: 'not-allowed',
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

const metaStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
  margin: '0.5rem 0 0 0',
};

const tagStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  padding: '0.125rem 0.375rem',
  background: '#fee2e2',
  color: '#991b1b',
  borderRadius: '0.25rem',
};

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

function healthBadgeStyle(isActive: boolean, realtimeStatus: string): React.CSSProperties {
  const isConnected = realtimeStatus === 'realtime';
  return {
    fontSize: '0.625rem',
    padding: '0.125rem 0.375rem',
    borderRadius: '9999px',
    background: isActive && isConnected ? '#dcfce7' : '#f3f4f6',
    color: isActive && isConnected ? '#166534' : '#6b7280',
    fontWeight: 500,
  };
}

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
  pointerEvents: 'none',
};