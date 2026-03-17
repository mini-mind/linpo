import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAgentDetail, getDefaultObserverDataSource, getNodeDetail, sendControlRequest, sendMessage } from '../api/client';
import {
  createObserverRealtimeClient,
  type ObserverRealtimeClient,
  type ObserverRealtimeClientOptions,
} from '../api/realtimeClient';
import {
  buildAgentDetailChannel,
  type AgentDetailResponse,
  type ControlAction,
  type ControlRequestStatus,
  type TopologyNode,
  type EventRecord,
  type NodeDetailResponse,
} from '../api/types';

type RealtimeStatus = 'realtime' | 'reconnecting' | 'resyncing' | 'disconnected' | 'error';
type WorkspaceTab = 'session' | 'detail' | 'config' | 'collab' | 'files' | 'tasks';

interface RealtimeState {
  status: RealtimeStatus;
  message: string | null;
}

interface ControlRequestState {
  requestId: string | null;
  status: ControlRequestStatus | null;
  action: ControlAction | null;
}

export function initialControlRequestState(): ControlRequestState {
  return { requestId: null, status: null, action: null };
}

export function applyControlRequestUpdate(
  previous: ControlRequestState,
  requestId: string,
  status: ControlRequestStatus
): ControlRequestState {
  if (previous.requestId !== requestId) return previous;
  return { ...previous, status };
}

type AgentDetailUpdate = AgentDetailResponse | null | ((previous: AgentDetailResponse | null) => AgentDetailResponse | null);

interface StartAgentDetailRealtimeOptions {
  agentId: string;
  getAgentDetailFn: (agentId: string) => Promise<AgentDetailResponse>;
  createRealtimeClientFn: (options: ObserverRealtimeClientOptions) => ObserverRealtimeClient;
  applyAgent: (update: AgentDetailUpdate) => void;
  setRealtimeState?: (state: RealtimeState) => void;
  onControlRequestUpdated?: (requestId: string, status: ControlRequestStatus) => void;
}

const AGENT_DETAIL_REALTIME_DATA_SOURCE = getDefaultObserverDataSource();
const MOBILE_BREAKPOINT = 768;

function withErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function findRootNode(nodes: TopologyNode[], rootNodeId: string): TopologyNode | null {
  return nodes.find((node) => node.id === rootNodeId)
    ?? nodes.find((node) => node.parent_id === null)
    ?? nodes[0]
    ?? null;
}

function mergeAgentDetailTopology(previous: AgentDetailResponse, nextNodes: TopologyNode[]): AgentDetailResponse {
  const nextRoot = findRootNode(nextNodes, previous.root_node_id);
  const nextRootNodeId = nextRoot?.id ?? previous.root_node_id;
  return {
    ...previous,
    status: nextRoot?.status ?? previous.status,
    is_active: nextRoot?.is_active ?? previous.is_active,
    root_node_id: nextRootNodeId,
    root_child_count: nextNodes.filter((node) => node.parent_id === nextRootNodeId).length,
    total_node_count: nextNodes.length,
    nodes: nextNodes,
  };
}

export async function startAgentDetailRealtime(options: StartAgentDetailRealtimeOptions): Promise<{ close: () => void } | null> {
  let latestAgent: AgentDetailResponse | null = null;
  const applySnapshot = (snapshot: AgentDetailResponse): void => {
    latestAgent = snapshot;
    options.applyAgent(snapshot);
  };

  const snapshot = await options.getAgentDetailFn(options.agentId);
  applySnapshot(snapshot);
  options.setRealtimeState?.({ status: 'reconnecting', message: null });

  const runResync = async (): Promise<void> => {
    options.setRealtimeState?.({ status: 'resyncing', message: null });
    try {
      const refreshed = await options.getAgentDetailFn(options.agentId);
      applySnapshot(refreshed);
      options.setRealtimeState?.({ status: 'realtime', message: null });
    } catch (error) {
      options.setRealtimeState?.({ status: 'error', message: withErrorMessage(error, '同步代理详情失败') });
    }
  };

  try {
    const realtimeClient = options.createRealtimeClientFn({
      dataSource: AGENT_DETAIL_REALTIME_DATA_SOURCE,
      channel: buildAgentDetailChannel(options.agentId),
      onMessage: (message) => {
        if (message.type === 'snapshot_ready') {
          options.setRealtimeState?.({ status: 'realtime', message: null });
          return;
        }
        if (message.type === 'topology_updated' && message.payload.agent_id === options.agentId) {
          if (!latestAgent) return;
          const nextAgent = mergeAgentDetailTopology(latestAgent, message.payload.nodes);
          latestAgent = nextAgent;
          options.applyAgent(nextAgent);
          options.setRealtimeState?.({ status: 'realtime', message: null });
          return;
        }
        if (message.type === 'error') {
          options.setRealtimeState?.({ status: 'error', message: message.payload.detail });
          return;
        }
        if (message.type === 'control_request_updated') {
          const { control_request } = message.payload;
          options.onControlRequestUpdated?.(control_request.request_id, control_request.status);
        }
      },
      onResyncRequired: () => { void runResync(); },
      onParseError: (_raw, error) => {
        options.setRealtimeState?.({ status: 'error', message: withErrorMessage(error, '解析实时消息失败') });
      },
      onDisconnected: () => {
        options.setRealtimeState?.({ status: 'disconnected', message: '实时连接意外断开' });
      },
    });
    realtimeClient.connect();
    return realtimeClient;
  } catch (error) {
    options.setRealtimeState?.({ status: 'error', message: withErrorMessage(error, '连接实时通道失败') });
    return null;
  }
}

const REALTIME_STATUS_CN: Record<RealtimeStatus, string> = {
  realtime: '已连接',
  reconnecting: '重连中',
  resyncing: '同步中',
  disconnected: '已断开',
  error: '错误',
};

const STATUS_BADGE_CN: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  finished: '已完成',
  error: '错误',
};

const CONTROL_STATUS_CN: Record<ControlRequestStatus, string> = {
  sending: '发送中...',
  accepted: '已接受',
  applied: '已生效',
  failed: '失败',
  timeout: '超时',
};

const EVENT_TYPE_CN: Record<string, string> = {
  agent_created: '代理创建',
  subagent_created: '子代理创建',
  activity_started: '活动开始',
  activity_stopped: '活动停止',
  status_changed: '状态变更',
  node_finished: '节点完成',
  task_started: '任务开始',
  task_finished: '任务完成',
  task_interrupted: '任务中断',
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

export function AgentWorkspace(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const isMobile = useIsMobile();
  const [agent, setAgent] = useState<AgentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>({ status: 'reconnecting', message: null });
  const [controlRequest, setControlRequest] = useState<ControlRequestState>(initialControlRequestState());
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('session');
  const [messageText, setMessageText] = useState('');
  const [nodeDetail, setNodeDetail] = useState<NodeDetailResponse | null>(null);
  const [nodeDetailLoading, setNodeDetailLoading] = useState(false);
  const [activeChannel, setActiveChannel] = useState('default');
  const [showSidebar, setShowSidebar] = useState(false);
  const [sendMessageStatus, setSendMessageStatus] = useState<'idle' | 'sending' | 'success' | 'failed'>('idle');

  const handlePause = async (): Promise<void> => {
    if (!agentId) return;
    setControlRequest({ requestId: null, status: 'sending', action: 'pause' });
    try {
      const response = await sendControlRequest(agentId, 'pause');
      setControlRequest({ requestId: response.request_id, status: response.status === 'accepted' ? 'accepted' : 'failed', action: 'pause' });
    } catch {
      setControlRequest({ requestId: null, status: 'failed', action: 'pause' });
    }
  };

  const handleResume = async (): Promise<void> => {
    if (!agentId) return;
    setControlRequest({ requestId: null, status: 'sending', action: 'resume' });
    try {
      const response = await sendControlRequest(agentId, 'resume');
      setControlRequest({ requestId: response.request_id, status: response.status === 'accepted' ? 'accepted' : 'failed', action: 'resume' });
    } catch {
      setControlRequest({ requestId: null, status: 'failed', action: 'resume' });
    }
  };

  const handleSendMessage = async (): Promise<void> => {
    if (!agentId || !messageText.trim()) return;
    setSendMessageStatus('sending');
    try {
      const response = await sendMessage(agentId, messageText.trim());
      if (response.status === 'accepted') {
        setSendMessageStatus('success');
        setMessageText('');
        setTimeout(() => setSendMessageStatus('idle'), 2000);
      } else {
        setSendMessageStatus('failed');
        setTimeout(() => setSendMessageStatus('idle'), 3000);
      }
    } catch {
      setSendMessageStatus('failed');
      setTimeout(() => setSendMessageStatus('idle'), 3000);
    }
  };

  const handleControlRequestUpdated = useCallback((requestId: string, status: ControlRequestStatus): void => {
    setControlRequest((prev) => applyControlRequestUpdate(prev, requestId, status));
  }, []);

  useEffect(() => {
    if (!agentId) {
      setError('未提供实例 ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setAgent(null);
    setControlRequest(initialControlRequestState());

    let cancelled = false;
    let realtimeHandle: { close: () => void } | null = null;

    async function loadSnapshotAndSubscribe(id: string) {
      try {
        const handle = await startAgentDetailRealtime({
          agentId: id,
          getAgentDetailFn: getAgentDetail,
          createRealtimeClientFn: createObserverRealtimeClient,
          applyAgent: (update) => {
            if (cancelled) return;
            setAgent((previousAgent) => typeof update === 'function' ? update(previousAgent) : update);
          },
          setRealtimeState: (state) => { if (!cancelled) setRealtimeState(state); },
          onControlRequestUpdated: (requestId, status) => { if (!cancelled) handleControlRequestUpdated(requestId, status); },
        });
        if (!cancelled) {
          realtimeHandle = handle;
        } else {
          handle?.close();
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '获取实例失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSnapshotAndSubscribe(agentId);
    return () => { cancelled = true; realtimeHandle?.close(); };
  }, [agentId, handleControlRequestUpdated]);

  useEffect(() => {
    if (!agentId || !agent) return;
    const rootNodeId = agent.root_node_id || agent.nodes[0]?.id;
    if (!rootNodeId) return;
    const currentAgentId = agentId;
    let cancelled = false;

    async function fetchNodeDetail(nodeId: string): Promise<void> {
      setNodeDetailLoading(true);
      try {
        const detail = await getNodeDetail(currentAgentId, nodeId);
        if (!cancelled) setNodeDetail(detail);
      } catch { }
      finally { if (!cancelled) setNodeDetailLoading(false); }
    }

    void fetchNodeDetail(rootNodeId);
    return () => { cancelled = true; };
  }, [agentId, agent]);

  if (loading) {
    return <div style={getContainerStyle(isMobile)}><p style={textStyle}>加载中...</p></div>;
  }

  if (error) {
    return <div style={getContainerStyle(isMobile)}><p style={errorStyle}>错误: {error}</p><Link to="/" style={backLinkStyle}>← 返回实例拓扑</Link></div>;
  }

  if (!agent) {
    return <div style={getContainerStyle(isMobile)}><p style={textStyle}>未找到实例</p><Link to="/" style={backLinkStyle}>← 返回实例拓扑</Link></div>;
  }

  const isPending = controlRequest.status === 'sending' || controlRequest.status === 'accepted';

  return (
    <div style={getContainerStyle(isMobile)}>
      <header style={getHeaderStyle(isMobile)}>
        <div style={headerRowStyle}>
          <Link to="/" style={backLinkStyle}>← 返回实例拓扑</Link>
        </div>
        <div style={titleRowStyle}>
          <h1 style={getTitleStyle(isMobile)}>{agent.name}</h1>
          <span style={realtimeBadgeStyle}>{REALTIME_STATUS_CN[realtimeState.status]}</span>
        </div>
      </header>

      <div style={getTabsStyle(isMobile)}>
        <button type="button" style={activeTab === 'session' ? getActiveTabStyle(isMobile) : getTabStyle(isMobile)} onClick={() => setActiveTab('session')}>会话</button>
        <button type="button" style={activeTab === 'detail' ? getActiveTabStyle(isMobile) : getTabStyle(isMobile)} onClick={() => setActiveTab('detail')}>详情</button>
        <button type="button" style={activeTab === 'config' ? getActiveTabStyle(isMobile) : getTabStyle(isMobile)} onClick={() => setActiveTab('config')} disabled>配置<span style={tabTagStyle}>v0.8</span></button>
        <button type="button" style={activeTab === 'collab' ? getActiveTabStyle(isMobile) : getTabStyle(isMobile)} onClick={() => setActiveTab('collab')} disabled>协作<span style={tabTagStyle}>v0.7</span></button>
        <button type="button" style={activeTab === 'files' ? getActiveTabStyle(isMobile) : getTabStyle(isMobile)} onClick={() => setActiveTab('files')} disabled>文件<span style={tabTagStyle}>v0.8</span></button>
        <button type="button" style={activeTab === 'tasks' ? getActiveTabStyle(isMobile) : getTabStyle(isMobile)} onClick={() => setActiveTab('tasks')} disabled>任务<span style={tabTagStyle}>未来</span></button>
      </div>

      <div style={getContentStyle(isMobile)}>
        {activeTab === 'session' && (
          <div style={getChatboxContainerStyle(isMobile)}>
            {isMobile && (
              <button type="button" style={mobileSidebarToggleStyle} onClick={() => setShowSidebar(!showSidebar)}>
                {showSidebar ? '隐藏渠道' : '渠道'}
              </button>
            )}
            {(!isMobile || showSidebar) && (
              <div style={getSidebarStyle(isMobile)}>
                <div style={sidebarHeaderStyle}>
                  <span style={sidebarTitleStyle}>会话渠道</span>
                  <button type="button" disabled style={addChannelButtonStyle}>+</button>
                </div>
                <div style={channelListStyle}>
                  <button type="button" style={activeChannel === 'default' ? activeChannelItemStyle : channelItemStyle} onClick={() => setActiveChannel('default')}>
                    <span style={channelIconStyle}>💬</span>
                    <span style={channelNameStyle}>默认会话</span>
                  </button>
                </div>
                <div style={sidebarFooterStyle}>
                  <span style={sidebarFooterTextStyle}>添加渠道 v0.4</span>
                </div>
              </div>
            )}
            <div style={chatAreaStyle}>
              <div style={messagesAreaStyle}>
                <div style={messagesEmptyStyle}>
                  <span style={messagesEmptyTextStyle}>暂无消息</span>
                  <span style={messagesEmptyHintStyle}>发送消息开始对话</span>
                </div>
              </div>
              <div style={getInputAreaStyle(isMobile)}>
                <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="输入消息..." style={getChatInputStyle(isMobile)} aria-label="消息输入" />
                <div style={getInputActionsStyle(isMobile)}>
                  <button
                    type="button"
                    style={sendMessageStatus === 'sending' || !messageText.trim() ? getDisabledButtonStyle(isMobile) : primaryButtonStyle}
                    onClick={handleSendMessage}
                    disabled={sendMessageStatus === 'sending' || !messageText.trim()}
                  >
                    {sendMessageStatus === 'sending' ? '发送中...' : sendMessageStatus === 'success' ? '已发送' : '发送'}
                  </button>
                  {sendMessageStatus === 'failed' && (
                    <span style={failedBadgeStyle}>发送失败</span>
                  )}
                  {agent.status === 'running' ? (
                    <button type="button" style={isPending ? getDisabledButtonStyle(isMobile) : dangerButtonStyle} onClick={handlePause} disabled={isPending}>
                      {isPending && controlRequest.status === 'sending' ? '暂停中...' : '暂停'}
                    </button>
                  ) : (
                    <button type="button" style={isPending ? getDisabledButtonStyle(isMobile) : successButtonStyle} onClick={handleResume} disabled={isPending}>
                      {isPending && controlRequest.status === 'sending' ? '恢复中...' : '恢复'}
                    </button>
                  )}
                  {controlRequest.status && controlRequest.status !== 'sending' && (
                    <span style={getControlStatusBadgeStyle(controlRequest.status)}>{CONTROL_STATUS_CN[controlRequest.status]}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'detail' && (
          <div style={detailTabStyle}>
            <div style={getTopRowStyle(isMobile)}>
              <section style={getSectionStyle(isMobile)}>
                <h2 style={getSectionTitleStyle(isMobile)}>当前状态</h2>
                <div style={getStatusGridStyle(isMobile)}>
                  <div style={statusItemStyle}><span style={statusLabelStyle}>节点 ID</span><span style={statusValueStyle}>{agent.nodes[0]?.id || agent.id}</span></div>
                  <div style={statusItemStyle}><span style={statusLabelStyle}>运行状态</span><span style={getStatusBadgeStyle(agent.status)}>{STATUS_BADGE_CN[agent.status] || agent.status}</span></div>
                  <div style={statusItemStyle}><span style={statusLabelStyle}>活跃状态</span><span style={agent.is_active ? activeTextStyle : inactiveTextStyle}>{agent.is_active ? '● 活跃' : '○ 不活跃'}</span></div>
                  <div style={statusItemStyle}><span style={statusLabelStyle}>子节点</span><span style={statusValueStyle}>{agent.root_child_count} 个</span></div>
                  <div style={statusItemStyle}><span style={statusLabelStyle}>总节点</span><span style={statusValueStyle}>{agent.total_node_count} 个</span></div>
                  {nodeDetail?.last_active_started_at && <div style={statusItemStyle}><span style={statusLabelStyle}>最近活跃</span><span style={statusValueStyle}>{formatTime(nodeDetail.last_active_started_at)}</span></div>}
                </div>
              </section>
              <section style={getSectionStyle(isMobile)}>
                <h2 style={getSectionTitleStyle(isMobile)}>资源占用</h2>
                <div style={placeholderSectionStyle}>
                  <span style={placeholderTextStyle}>暂不支持</span>
                  <span style={placeholderHintStyle}>需要 OpenClaw 提供资源监控接口</span>
                </div>
              </section>
            </div>
            <section style={getSectionStyle(isMobile)}>
              <h2 style={getSectionTitleStyle(isMobile)}>历史事件</h2>
              {nodeDetailLoading ? (
                <div style={emptyEventsStyle}><p style={emptyEventsTextStyle}>加载中...</p></div>
              ) : nodeDetail?.events && nodeDetail.events.length > 0 ? (
                <ul style={eventListStyle}>
                  {nodeDetail.events.map((event: EventRecord) => (
                    <li key={event.id} style={eventItemStyle}>
                      <div style={eventHeaderStyle}>
                        <span style={eventTypeStyle}>{EVENT_TYPE_CN[event.type] || event.type}</span>
                        <span style={eventTimeStyle}>{formatTime(event.timestamp)}</span>
                      </div>
                      <p style={eventDescStyle}>{event.description}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={emptyEventsStyle}><p style={emptyEventsTextStyle}>暂无历史事件</p></div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'config' && (
          <div style={detailTabStyle}>
            <section style={getSectionStyle(isMobile)}>
              <h2 style={getSectionTitleStyle(isMobile)}>实例信息</h2>
              <div style={getConfigGridStyle(isMobile)}>
                <div style={configItemStyle}><span style={configLabelStyle}>实例 ID</span><span style={configValueStyle}>{agent.id}</span></div>
                <div style={configItemStyle}><span style={configLabelStyle}>实例名称</span><input type="text" value={agent.name} disabled style={configInputStyle} aria-label="实例名称" /></div>
              </div>
            </section>
            <section style={getSectionStyle(isMobile)}>
              <h2 style={getSectionTitleStyle(isMobile)}>连接配置</h2>
              <div style={configContainerStyle}>
                <div style={configItemStyle}><span style={configLabelStyle}>实例端点</span><input type="text" value="ws://127.0.0.1:28789" disabled style={configInputStyle} aria-label="实例端点" /></div>
                <div style={configItemStyle}><span style={configLabelStyle}>环境变量</span><textarea disabled placeholder="OPENCLAW_GATEWAY_TOKEN=***&#10;OPENCLAW_ORIGIN=http://127.0.0.1:28789" style={configTextareaStyle} aria-label="环境变量" /></div>
              </div>
            </section>
            <section style={getSectionStyle(isMobile)}>
              <h2 style={getSectionTitleStyle(isMobile)}>Agent 绑定</h2>
              <div style={placeholderSectionStyle}><span style={placeholderTextStyle}>v0.4 功能</span><span style={placeholderHintStyle}>将支持配置 agent 与工具、资源的绑定关系。</span></div>
            </section>
            <section style={getSectionStyle(isMobile)}>
              <h2 style={getSectionTitleStyle(isMobile)}>高级设置</h2>
              <div style={placeholderSectionStyle}><span style={placeholderTextStyle}>暂不支持</span><span style={placeholderHintStyle}>将支持配置权限等高级选项。</span></div>
            </section>
            <div style={configActionsStyle}>
              <button type="button" disabled style={getDisabledButtonStyle(isMobile)}>保存配置<span style={disabledTagStyle}>v0.8</span></button>
            </div>
          </div>
        )}

        {activeTab === 'collab' && (
          <div style={detailTabStyle}>
            <section style={getSectionStyle(isMobile)}>
              <h2 style={getSectionTitleStyle(isMobile)}>协作记录</h2>
              <div style={collabContainerStyle}>
                <div style={collabEmptyStyle}><span style={collabEmptyTextStyle}>暂无协作记录</span><span style={collabEmptyHintStyle}>跨实例消息传递功能将在 v0.7 提供</span></div>
                <div style={collabListStyle}>
                  <div style={collabItemStyle}>
                    <div style={collabItemHeaderStyle}><span style={collabItemNameStyle}>示例协作记录</span><span style={collabItemTimeStyle}>2026-03-17 16:30:00</span></div>
                    <p style={collabItemDescStyle}>发送消息至 main@instance-2</p>
                    <span style={collabItemStatusStyle}>已送达</span>
                  </div>
                  <div style={collabItemStyle}>
                    <div style={collabItemHeaderStyle}><span style={collabItemNameStyle}>示例协作记录 2</span><span style={collabItemTimeStyle}>2026-03-17 15:00:00</span></div>
                    <p style={collabItemDescStyle}>接收来自 worker@instance-3 的结果</p>
                    <span style={collabItemStatusStyle}>已完成</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'files' && (
          <div style={placeholderContentStyle}>
            <div style={getPlaceholderBoxStyle(isMobile)}>
              <h3 style={placeholderTitleStyle}>文件系统</h3>
              <p style={placeholderTextStyle}>此功能将在 v0.8 版本中提供。</p>
              <p style={placeholderHintStyle}>将支持浏览和编辑实例的工作目录文件。</p>
            </div>
          </div>
        )}

        {activeTab === 'tasks' && (
          <div style={placeholderContentStyle}>
            <div style={getPlaceholderBoxStyle(isMobile)}>
              <h3 style={placeholderTitleStyle}>任务看板</h3>
              <p style={placeholderTextStyle}>此功能将在后续版本中提供。</p>
              <p style={placeholderHintStyle}>将显示实例正在执行的任务及其状态。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function getStatusBadgeStyle(status: string): React.CSSProperties {
  const colors: Record<string, { bg: string; text: string }> = {
    running: { bg: '#dcfce7', text: '#166534' },
    idle: { bg: '#f3f4f6', text: '#6b7280' },
    finished: { bg: '#dbeafe', text: '#1e40af' },
    error: { bg: '#fee2e2', text: '#dc2626' },
  };
  const c = colors[status] || colors.idle;
  return { display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 500, background: c.bg, color: c.text };
}

function getControlStatusBadgeStyle(status: ControlRequestStatus): React.CSSProperties {
  const base: React.CSSProperties = { fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontWeight: 500 };
  switch (status) {
    case 'sending': return { ...base, background: '#dbeafe', color: '#1e40af' };
    case 'accepted': return { ...base, background: '#fef3c7', color: '#92400e' };
    case 'applied': return { ...base, background: '#d1fae5', color: '#065f46' };
    case 'failed': return { ...base, background: '#fee2e2', color: '#991b1b' };
    case 'timeout': return { ...base, background: '#fce7f3', color: '#9d174d' };
    default: return base;
  }
}

function getContainerStyle(isMobile: boolean): React.CSSProperties {
  return {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#f4f1ea',
    color: '#1f2933',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  };
}

function getHeaderStyle(isMobile: boolean): React.CSSProperties {
  return {
    padding: isMobile ? '0.75rem 1rem' : '1rem 2rem',
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
  };
}

function getTitleStyle(isMobile: boolean): React.CSSProperties {
  return {
    fontSize: isMobile ? '1.25rem' : '1.5rem',
    fontWeight: 600,
    margin: 0,
    color: '#1f2933',
  };
}

function getTabsStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    padding: isMobile ? '0.5rem 0.75rem' : '0.75rem 2rem',
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
  };
}

function getTabStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: isMobile ? '0.375rem 0.625rem' : '0.5rem 1rem',
    fontSize: isMobile ? '0.75rem' : '0.875rem',
    fontWeight: 500,
    borderRadius: '0.375rem',
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#6b7280',
    cursor: 'pointer',
    marginRight: '0.375rem',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
}

function getActiveTabStyle(isMobile: boolean): React.CSSProperties {
  return {
    ...getTabStyle(isMobile),
    border: '1px solid #3b82f6',
    background: '#eff6ff',
    color: '#3b82f6',
  };
}

function getContentStyle(isMobile: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: isMobile ? '0.75rem' : '1.5rem 2rem',
  };
}

function getChatboxContainerStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    height: isMobile ? 'calc(100vh - 200px)' : 'calc(100vh - 180px)',
    minHeight: isMobile ? '300px' : '400px',
    background: '#fff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
  };
}

function getSidebarStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: isMobile ? '100%' : '200px',
    background: '#f9fafb',
    borderRight: isMobile ? 'none' : '1px solid #e5e7eb',
    borderBottom: isMobile ? '1px solid #e5e7eb' : 'none',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: isMobile ? '150px' : 'none',
  };
}

function getInputAreaStyle(isMobile: boolean): React.CSSProperties {
  return {
    padding: isMobile ? '0.75rem' : '1rem',
    borderTop: '1px solid #e5e7eb',
    background: '#fff',
  };
}

function getChatInputStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: isMobile ? '0.5rem' : '0.75rem',
    fontSize: isMobile ? '0.8125rem' : '0.875rem',
    borderRadius: '0.375rem',
    border: '1px solid #d1d5db',
    background: '#f9fafb',
    color: '#9ca3af',
    minHeight: isMobile ? '60px' : '80px',
    resize: 'none',
    boxSizing: 'border-box',
    marginBottom: '0.5rem',
  };
}

function getInputActionsStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: isMobile ? '0.375rem' : '0.5rem',
    flexWrap: 'wrap',
  };
}

function getDisabledButtonStyle(isMobile: boolean): React.CSSProperties {
  return {
    padding: isMobile ? '0.375rem 0.625rem' : '0.5rem 1rem',
    fontSize: isMobile ? '0.75rem' : '0.875rem',
    fontWeight: 500,
    borderRadius: '0.375rem',
    border: '1px solid #d1d5db',
    background: '#f3f4f6',
    color: '#9ca3af',
    cursor: 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  };
}

function getSectionStyle(isMobile: boolean): React.CSSProperties {
  return {
    background: '#fffdf8',
    border: '1px solid #d6cfc2',
    borderRadius: '0.5rem',
    padding: isMobile ? '1rem' : '1.5rem',
  };
}

function getSectionTitleStyle(isMobile: boolean): React.CSSProperties {
  return {
    fontSize: isMobile ? '0.875rem' : '1rem',
    fontWeight: 600,
    margin: '0 0 0.5rem 0',
    color: '#1f2933',
  };
}

function getTopRowStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
    gap: isMobile ? '0.75rem' : '1.5rem',
  };
}

function getStatusGridStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
    gap: '0.5rem',
  };
}

function getConfigGridStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
    gap: '0.75rem',
  };
}

function getPlaceholderBoxStyle(isMobile: boolean): React.CSSProperties {
  return {
    background: '#fffdf8',
    border: '1px dashed #d6cfc2',
    borderRadius: '0.5rem',
    padding: isMobile ? '1.5rem' : '3rem',
    textAlign: 'center',
    maxWidth: '30rem',
  };
}

const headerRowStyle: React.CSSProperties = { marginBottom: '0.5rem' };
const titleRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.75rem' };
const realtimeBadgeStyle: React.CSSProperties = { fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '9999px', background: '#dbeafe', color: '#1e40af', fontWeight: 500 };
const backLinkStyle: React.CSSProperties = { display: 'inline-block', color: '#6b7280', textDecoration: 'none', fontSize: '0.875rem' };
const tabTagStyle: React.CSSProperties = { fontSize: '0.625rem', padding: '0.125rem 0.25rem', background: '#f3f4f6', color: '#6b7280', borderRadius: '0.25rem' };

const mobileSidebarToggleStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#f9fafb',
  border: 'none',
  borderBottom: '1px solid #e5e7eb',
  fontSize: '0.875rem',
  color: '#6b7280',
  cursor: 'pointer',
  textAlign: 'left',
};

const sidebarHeaderStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb' };
const sidebarTitleStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' };
const addChannelButtonStyle: React.CSSProperties = { width: '24px', height: '24px', borderRadius: '0.25rem', border: '1px solid #d1d5db', background: '#fff', color: '#9ca3af', cursor: 'not-allowed', fontSize: '1rem', lineHeight: 1 };
const channelListStyle: React.CSSProperties = { flex: 1, padding: '0.5rem', overflow: 'auto' };
const channelItemStyle: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: 'none', background: 'transparent', color: '#4b5563', cursor: 'pointer', textAlign: 'left' };
const activeChannelItemStyle: React.CSSProperties = { ...channelItemStyle, background: '#eff6ff', color: '#3b82f6' };
const channelIconStyle: React.CSSProperties = { fontSize: '1rem' };
const channelNameStyle: React.CSSProperties = { fontSize: '0.875rem', fontWeight: 500 };
const sidebarFooterStyle: React.CSSProperties = { padding: '0.75rem 1rem', borderTop: '1px solid #e5e7eb', textAlign: 'center' };
const sidebarFooterTextStyle: React.CSSProperties = { fontSize: '0.75rem', color: '#9ca3af' };
const chatAreaStyle: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 };
const messagesAreaStyle: React.CSSProperties = { flex: 1, overflow: 'auto', padding: '1rem' };
const messagesEmptyStyle: React.CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' };
const messagesEmptyTextStyle: React.CSSProperties = { fontSize: '1rem', color: '#6b7280', marginBottom: '0.25rem' };
const messagesEmptyHintStyle: React.CSSProperties = { fontSize: '0.875rem', color: '#9ca3af' };

const detailTabStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '1rem' };
const statusItemStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem' };
const statusLabelStyle: React.CSSProperties = { fontSize: '0.75rem', color: '#6b7280' };
const statusValueStyle: React.CSSProperties = { fontSize: '0.875rem', color: '#1f2933' };
const activeTextStyle: React.CSSProperties = { fontSize: '0.875rem', color: '#10b981' };
const inactiveTextStyle: React.CSSProperties = { fontSize: '0.875rem', color: '#9ca3af' };
const placeholderSectionStyle: React.CSSProperties = { padding: '1rem', background: '#f9fafb', borderRadius: '0.375rem', border: '1px dashed #d1d5db', textAlign: 'center' };
const placeholderTextStyle: React.CSSProperties = { display: 'block', fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' };
const placeholderHintStyle: React.CSSProperties = { display: 'block', fontSize: '0.75rem', color: '#9ca3af' };
const eventListStyle: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' };
const eventItemStyle: React.CSSProperties = { padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem', border: '1px solid #e5e7eb' };
const eventHeaderStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' };
const eventTypeStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 500, color: '#7c5e3c' };
const eventTimeStyle: React.CSSProperties = { fontSize: '0.75rem', color: '#9ca3af' };
const eventDescStyle: React.CSSProperties = { fontSize: '0.875rem', color: '#4b5563', margin: 0, lineHeight: 1.5 };
const emptyEventsStyle: React.CSSProperties = { padding: '1.5rem', textAlign: 'center' };
const emptyEventsTextStyle: React.CSSProperties = { color: '#9ca3af', fontSize: '0.875rem' };

const configContainerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.75rem' };
const configItemStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.375rem' };
const configLabelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 500, color: '#374151' };
const configValueStyle: React.CSSProperties = { fontSize: '0.875rem', color: '#6b7280' };
const configInputStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', fontSize: '0.875rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#f9fafb', color: '#9ca3af' };
const configTextareaStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', fontSize: '0.875rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#f9fafb', color: '#9ca3af', minHeight: '60px', resize: 'vertical' };
const configActionsStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem' };

const collabContainerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.75rem' };
const collabEmptyStyle: React.CSSProperties = { padding: '0.75rem', background: '#f9fafb', borderRadius: '0.5rem', textAlign: 'center' };
const collabEmptyTextStyle: React.CSSProperties = { display: 'block', fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' };
const collabEmptyHintStyle: React.CSSProperties = { display: 'block', fontSize: '0.75rem', color: '#9ca3af' };
const collabListStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.5rem' };
const collabItemStyle: React.CSSProperties = { padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem', border: '1px solid #e5e7eb' };
const collabItemHeaderStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' };
const collabItemNameStyle: React.CSSProperties = { fontSize: '0.875rem', fontWeight: 500, color: '#1f2933' };
const collabItemTimeStyle: React.CSSProperties = { fontSize: '0.75rem', color: '#9ca3af' };
const collabItemDescStyle: React.CSSProperties = { fontSize: '0.75rem', color: '#6b7280', margin: '0 0 0.5rem 0' };
const collabItemStatusStyle: React.CSSProperties = { fontSize: '0.625rem', padding: '0.125rem 0.5rem', background: '#dcfce7', color: '#166534', borderRadius: '9999px' };

const placeholderContentStyle: React.CSSProperties = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '20rem' };
const placeholderTitleStyle: React.CSSProperties = { fontSize: '1rem', fontWeight: 600, color: '#1f2933', margin: '0 0 0.75rem 0' };

const dangerButtonStyle: React.CSSProperties = { padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, borderRadius: '0.375rem', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' };
const successButtonStyle: React.CSSProperties = { padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, borderRadius: '0.375rem', border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer' };
const primaryButtonStyle: React.CSSProperties = { padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, borderRadius: '0.375rem', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' };
const failedBadgeStyle: React.CSSProperties = { fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', background: '#fee2e2', color: '#991b1b', fontWeight: 500 };
const disabledTagStyle: React.CSSProperties = { fontSize: '0.625rem', padding: '0.125rem 0.25rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.25rem' };

const textStyle: React.CSSProperties = { color: '#6b7280', textAlign: 'center', padding: '2rem' };
const errorStyle: React.CSSProperties = { color: '#dc2626', textAlign: 'center', padding: '2rem' };