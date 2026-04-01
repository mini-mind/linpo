import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  continueKanbanTask,
  getAggregateOverview,
  listKanbanTasks,
} from '../api/client';
import {
  createBoardTasksSseClient,
  createObserverRealtimeClient,
  type BoardRealtimeMessage,
  type ObserverRealtimeClient,
} from '../api/realtimeClient';
import type {
  AggregateOverviewGlobalEvent,
  AggregateOverviewResponse,
  AggregateOverviewTokenGroup,
  ErrorEnvelope,
  KanbanTaskItem,
  ObserverRealtimeMessage,
} from '../api/types';
import { buildAgentDetailChannel } from '../api/types';
import { useCurrentInstanceId } from '../hooks/useCurrentInstance';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';

type SummaryMetricKind = 'tokens' | 'tasks';

type SummarySeries = {
  id: string;
  name: string;
  color: string;
  values: number[];
};

type SummaryMetric = {
  kind: SummaryMetricKind;
  title: string;
  hint: string;
  labels: string[];
  series: SummarySeries[];
  totalLabel: string;
};

type SummaryEventItem = {
  id: string;
  type: string;
  instanceName: string;
  agentName: string | null;
  timestamp: string;
  description: string;
};

const BOARD_REALTIME_ID = 'default';
const SERIES_COLORS = ['#0f766e', '#0284c7', '#f97316', '#dc2626', '#7c3aed', '#65a30d'];

export function SummaryPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [currentInstanceId] = useCurrentInstanceId();
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [tasks, setTasks] = useState<KanbanTaskItem[]>([]);
  const [events, setEvents] = useState<SummaryEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<Error | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [continuingTaskId, setContinuingTaskId] = useState<string | null>(null);
  const boardRealtimeRef = useRef<ReturnType<typeof createBoardTasksSseClient> | null>(null);
  const agentsListRealtimeRef = useRef<ObserverRealtimeClient | null>(null);
  const agentRealtimeRefs = useRef<Map<string, ObserverRealtimeClient>>(new Map());
  const overviewRefreshTimerRef = useRef<number | null>(null);
  const eventBaselineInstanceRef = useRef<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const data = await getAggregateOverview();
      setOverview(data);
      setOverviewError(null);
    } catch (error) {
      setOverviewError(error instanceof Error ? error : new Error('获取摘要失败'));
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const result = await listKanbanTasks();
      setTasks(result);
      setTasksError(null);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : '读取审批任务失败');
    }
  }, []);

  const loadPage = useCallback(async () => {
    try {
      setIsLoading(true);
      await Promise.all([loadOverview(), loadTasks()]);
    } finally {
      setIsLoading(false);
    }
  }, [loadOverview, loadTasks]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const scheduleOverviewRefresh = useCallback(() => {
    if (overviewRefreshTimerRef.current !== null) {
      return;
    }
    overviewRefreshTimerRef.current = window.setTimeout(() => {
      overviewRefreshTimerRef.current = null;
      void loadOverview();
    }, 1200);
  }, [loadOverview]);

  const applyBoardRealtimeUpdate = useCallback(
    (message: BoardRealtimeMessage) => {
      if (message.type === 'error') {
        setTasksError(message.payload.detail || '审批任务实时同步失败');
        return;
      }
      if (message.type !== 'tasks_changed') {
        return;
      }
      if (message.payload.action === 'upsert' && message.payload.task) {
        const nextTask = message.payload.task;
        setTasks((current) => {
          const index = current.findIndex((item) => item.id === nextTask.id);
          if (index < 0) {
            return [nextTask, ...current];
          }
          const merged = [...current];
          merged[index] = nextTask;
          return merged;
        });
        scheduleOverviewRefresh();
        return;
      }
      if (message.payload.action === 'delete' && message.payload.task_id) {
        setTasks((current) => current.filter((item) => item.id !== message.payload.task_id));
        scheduleOverviewRefresh();
      }
    },
    [scheduleOverviewRefresh]
  );

  useEffect(() => {
    let cancelled = false;
    let reconnectAttempts = 0;
    let reconnectTimerId: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const connectRealtime = () => {
      if (cancelled) {
        return;
      }
      const client = createBoardTasksSseClient({
        boardId: BOARD_REALTIME_ID,
        onMessage: (message) => {
          if (cancelled) {
            return;
          }
          reconnectAttempts = 0;
          applyBoardRealtimeUpdate(message);
        },
        onDisconnected: () => {
          if (cancelled || reconnectTimerId !== null) {
            return;
          }
          const delay = Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
          reconnectAttempts += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            connectRealtime();
          }, delay);
        },
      });
      client.connect();
      boardRealtimeRef.current = client;
    };

    connectRealtime();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      boardRealtimeRef.current?.close();
      boardRealtimeRef.current = null;
    };
  }, [applyBoardRealtimeUpdate]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      void loadOverview();
    }, 30000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [loadOverview]);

  useEffect(() => {
    return () => {
      if (overviewRefreshTimerRef.current !== null) {
        window.clearTimeout(overviewRefreshTimerRef.current);
      }
    };
  }, []);

  const currentInstanceName = useMemo(() => {
    if (!currentInstanceId) {
      return null;
    }
    const byTask = tasks.find((task) => task.instance_id === currentInstanceId);
    if (byTask) {
      const value = String(byTask.extras.instance_name ?? '').trim();
      if (value) {
        return value;
      }
    }
    const byAgent = overview?.agents.find((item) => item.instance_id === currentInstanceId);
    return byAgent?.instance_name ?? null;
  }, [currentInstanceId, overview?.agents, tasks]);

  const currentInstanceAgentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of overview?.agents ?? []) {
      if (currentInstanceId && item.instance_id !== currentInstanceId) {
        continue;
      }
      map.set(item.agent_id, item.agent_name);
    }
    return map;
  }, [currentInstanceId, overview?.agents]);

  const currentInstanceAgentIds = useMemo(
    () => [...currentInstanceAgentMap.keys()].sort((left, right) => left.localeCompare(right)),
    [currentInstanceAgentMap]
  );

  useEffect(() => {
    if (!overview) {
      return;
    }
    const baselineKey = currentInstanceId ?? '__all__';
    if (eventBaselineInstanceRef.current === baselineKey) {
      return;
    }
    eventBaselineInstanceRef.current = baselineKey;
    setEvents(buildInitialEvents(overview.global_events, currentInstanceId));
  }, [currentInstanceId, overview]);

  const appendRealtimeEvent = useCallback((item: SummaryEventItem) => {
    setEvents((current) => {
      const next = [item, ...current.filter((entry) => entry.id !== item.id)];
      next.sort((left, right) => {
        const leftTs = Date.parse(left.timestamp);
        const rightTs = Date.parse(right.timestamp);
        return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
      });
      return next.slice(0, 80);
    });
  }, []);

  const closeRealtimeConnections = useCallback(() => {
    agentsListRealtimeRef.current?.close();
    agentsListRealtimeRef.current = null;
    for (const client of agentRealtimeRefs.current.values()) {
      client.close();
    }
    agentRealtimeRefs.current.clear();
  }, []);

  useEffect(() => {
    closeRealtimeConnections();
    if (!currentInstanceId) {
      return undefined;
    }

    const client = createObserverRealtimeClient({
      dataSource: 'openclaw',
      instanceId: currentInstanceId,
      channel: 'agents:list',
      onMessage: (message) => {
        if (message.type !== 'agent_summary_updated') {
          return;
        }
        appendRealtimeEvent(
          toSummaryEventFromObserver({
            id: `agent-summary:${message.channel}:${message.seq}`,
            type: 'agent_summary_updated',
            timestamp: message.timestamp,
            instanceName: currentInstanceName ?? '当前实例',
            agentName: message.payload.agent.name ?? message.payload.agent.id,
            description: `${message.payload.agent.name ?? message.payload.agent.id} 状态已更新`,
          })
        );
      },
    });
    agentsListRealtimeRef.current = client;
    client.connect();

    return () => {
      client.close();
      if (agentsListRealtimeRef.current === client) {
        agentsListRealtimeRef.current = null;
      }
    };
  }, [appendRealtimeEvent, closeRealtimeConnections, currentInstanceId, currentInstanceName]);

  useEffect(() => {
    if (!currentInstanceId) {
      closeRealtimeConnections();
      return;
    }
    const activeSet = new Set(currentInstanceAgentIds);
    for (const [agentId, client] of agentRealtimeRefs.current.entries()) {
      if (!activeSet.has(agentId)) {
        client.close();
        agentRealtimeRefs.current.delete(agentId);
      }
    }
    for (const agentId of currentInstanceAgentIds) {
      if (agentRealtimeRefs.current.has(agentId)) {
        continue;
      }
      const detailClient = createObserverRealtimeClient({
        dataSource: 'openclaw',
        instanceId: currentInstanceId,
        channel: buildAgentDetailChannel(agentId),
        onMessage: (message) => {
          handleAgentDetailRealtimeMessage({
            message,
            agentId,
            agentName: currentInstanceAgentMap.get(agentId) ?? agentId,
            instanceName: currentInstanceName ?? '当前实例',
            appendRealtimeEvent,
          });
        },
      });
      detailClient.connect();
      agentRealtimeRefs.current.set(agentId, detailClient);
    }

    return () => {
      for (const client of agentRealtimeRefs.current.values()) {
        client.close();
      }
      agentRealtimeRefs.current.clear();
    };
  }, [
    appendRealtimeEvent,
    closeRealtimeConnections,
    currentInstanceAgentIds,
    currentInstanceAgentMap,
    currentInstanceId,
    currentInstanceName,
  ]);

  const approvalTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status === 'blocked_by_approval')
        .sort((left, right) => {
          const leftTs = Date.parse(left.updated_at);
          const rightTs = Date.parse(right.updated_at);
          return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
        }),
    [tasks]
  );

  const metric = useMemo(() => buildSummaryMetric(overview?.token_groups ?? [], tasks), [overview?.token_groups, tasks]);

  const handleContinueTask = useCallback(
    async (taskId: string) => {
      try {
        setContinuingTaskId(taskId);
        await continueKanbanTask(taskId);
        addToast('审批项已继续执行', 'success');
        await Promise.all([loadTasks(), loadOverview()]);
      } catch (error) {
        addToast(error instanceof Error ? error.message : '继续审批失败', 'error');
      } finally {
        setContinuingTaskId(null);
      }
    },
    [addToast, loadOverview, loadTasks]
  );

  if (isLoading) {
    return (
      <div style={pageStyle}>
        <header style={isMobile ? { ...toolbarStyle, ...toolbarMobileStyle } : toolbarStyle}>
          <div style={toolbarLeftStyle}>
            <span style={toolbarTitleStyle}>摘要</span>
            <span style={toolbarMetaStyle}>正在汇总审批与统计…</span>
          </div>
        </header>
        <div style={contentStyle}>
          <section style={chartCardStyle}>正在加载统计曲线…</section>
          <div style={getBodyLayoutStyle(isMobile)}>
            <section style={approvalPaneStyle}>正在加载审批项…</section>
            <aside style={getEventsPaneStyle(isMobile)}>正在加载事件流…</aside>
          </div>
        </div>
      </div>
    );
  }

  if (overviewError && !overview) {
    const envelope = overviewError instanceof ApiError ? overviewError.envelope : null;
    return (
      <div style={pageStyle}>
        <div style={contentStyle}>
          <section style={fatalErrorCardStyle}>
            <h2 style={fatalErrorTitleStyle}>摘要暂时不可用</h2>
            <p style={fatalErrorTextStyle}>{overviewError.message}</p>
            {envelope ? <EnvelopeErrorSummary envelope={envelope} /> : null}
            <button type="button" style={primaryButtonStyle} onClick={() => void loadPage()}>
              重试
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <header style={isMobile ? { ...toolbarStyle, ...toolbarMobileStyle } : toolbarStyle} role="toolbar" aria-label="摘要工具栏">
        <div style={toolbarLeftStyle}>
          <span style={toolbarTitleStyle}>摘要</span>
          <span style={toolbarMetaStyle}>待审批 {approvalTasks.length} 项</span>
          <span style={toolbarMetaStyle}>事件 {events.length} 条</span>
          <span style={toolbarMetaStyle}>{metric.kind === 'tokens' ? '指标: Token' : '指标: 任务节点'}</span>
        </div>
        <div style={toolbarActionsStyle}>
          <button type="button" style={ghostButtonStyle} onClick={() => void loadPage()}>
            刷新
          </button>
        </div>
      </header>

      <div style={contentStyle}>
        <SummaryChart metric={metric} />
        <div style={getBodyLayoutStyle(isMobile)}>
          <ApprovalPane
            approvalTasks={approvalTasks}
            tasksError={tasksError}
            continuingTaskId={continuingTaskId}
            onContinueTask={handleContinueTask}
            onOpenKanban={() => navigate('/kanban')}
          />
          <EventsPane events={events} isMobile={isMobile} />
        </div>
      </div>
    </div>
  );
}

function SummaryChart({ metric }: { metric: SummaryMetric }): JSX.Element {
  const maxValue = Math.max(1, ...metric.series.flatMap((item) => item.values));
  const pointCount = Math.max(1, metric.labels.length - 1);
  const viewBoxWidth = 100;
  const viewBoxHeight = 36;

  return (
    <section style={chartCardStyle} data-testid="summary-chart">
      <div style={chartHeaderStyle}>
        <div>
          <h2 style={sectionTitleStyle}>{metric.title}</h2>
          <p style={sectionHintStyle}>{metric.hint}</p>
        </div>
        <div style={chartTotalBadgeStyle}>{metric.totalLabel}</div>
      </div>

      {metric.labels.length === 0 || metric.series.length === 0 ? (
        <div style={emptyStateStyle}>当前没有可展示的统计样本</div>
      ) : (
        <>
          <div style={chartLegendStyle}>
            {metric.series.map((item) => (
              <span key={item.id} style={legendItemStyle}>
                <span style={{ ...legendDotStyle, background: item.color }} />
                {item.name}
              </span>
            ))}
          </div>
          <div style={chartViewportStyle}>
            <svg viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`} preserveAspectRatio="none" style={chartSvgStyle} aria-label={metric.title}>
              <defs>
                <linearGradient id="summary-grid" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(15, 118, 110, 0.14)" />
                  <stop offset="100%" stopColor="rgba(15, 118, 110, 0)" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width={viewBoxWidth} height={viewBoxHeight} fill="url(#summary-grid)" rx="3" />
              {[8, 18, 28].map((y) => (
                <line
                  key={y}
                  x1="0"
                  y1={y}
                  x2={viewBoxWidth}
                  y2={y}
                  stroke="rgba(148, 163, 184, 0.24)"
                  strokeWidth="0.35"
                />
              ))}
              {metric.series.map((item) => {
                const points = item.values
                  .map((value, index) => {
                    const x = pointCount === 0 ? 0 : (index / pointCount) * viewBoxWidth;
                    const y = viewBoxHeight - 4 - (value / maxValue) * (viewBoxHeight - 8);
                    return `${x},${y}`;
                  })
                  .join(' ');
                return (
                  <g key={item.id}>
                    <polyline
                      fill="none"
                      stroke={item.color}
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={points}
                    />
                    {item.values.map((value, index) => {
                      const x = pointCount === 0 ? 0 : (index / pointCount) * viewBoxWidth;
                      const y = viewBoxHeight - 4 - (value / maxValue) * (viewBoxHeight - 8);
                      return <circle key={`${item.id}:${metric.labels[index]}`} cx={x} cy={y} r="1.1" fill={item.color} />;
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
          <div style={chartLabelsStyle}>
            {metric.labels.map((label) => (
              <span key={label} style={chartLabelStyle}>
                {formatShortLabel(label)}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ApprovalPane({
  approvalTasks,
  tasksError,
  continuingTaskId,
  onContinueTask,
  onOpenKanban,
}: {
  approvalTasks: KanbanTaskItem[];
  tasksError: string | null;
  continuingTaskId: string | null;
  onContinueTask: (taskId: string) => void;
  onOpenKanban: () => void;
}): JSX.Element {
  return (
    <section style={approvalPaneStyle} data-testid="summary-approval-list">
      <div style={sectionHeaderStyle}>
        <div>
          <h2 style={sectionTitleStyle}>审批项</h2>
          <p style={sectionHintStyle}>集中处理被敏感操作阻塞的任务节点。</p>
        </div>
        <button type="button" style={ghostButtonStyle} onClick={onOpenKanban}>
          打开看板
        </button>
      </div>

      {tasksError ? <div style={inlineErrorStyle}>{tasksError}</div> : null}
      {approvalTasks.length === 0 ? (
        <div style={emptyStateStyle}>当前没有待审批任务</div>
      ) : (
        <div style={approvalListStyle}>
          {approvalTasks.map((task) => {
            const requirementTitle = String(task.extras.requirement_title ?? '').trim() || '未命名流程';
            const dependencyLabel = String(task.extras.dependencies ?? task.extras.dependency_titles ?? '').trim();
            return (
              <article key={task.id} style={approvalCardStyle}>
                <div style={approvalCardHeaderStyle}>
                  <div style={approvalCardTitleWrapStyle}>
                    <span style={approvalBadgeStyle}>待审批</span>
                    <h3 style={approvalCardTitleStyle}>{task.title}</h3>
                  </div>
                  <span style={approvalCardMetaStyle}>{formatDateTime(task.updated_at)}</span>
                </div>
                <p style={approvalDescriptionStyle}>{task.summary || '暂无任务描述'}</p>
                <div style={approvalMetaGridStyle}>
                  <div style={approvalMetaItemStyle}>
                    <span style={approvalMetaLabelStyle}>流程</span>
                    <span style={approvalMetaValueStyle}>{requirementTitle}</span>
                  </div>
                  <div style={approvalMetaItemStyle}>
                    <span style={approvalMetaLabelStyle}>Agent</span>
                    <span style={approvalMetaValueStyle}>{task.agent_name || task.agent_id || '待分配'}</span>
                  </div>
                  <div style={approvalMetaItemStyle}>
                    <span style={approvalMetaLabelStyle}>任务ID</span>
                    <span style={approvalMetaValueStyle}>{task.id.slice(0, 8)}</span>
                  </div>
                  <div style={approvalMetaItemStyle}>
                    <span style={approvalMetaLabelStyle}>依赖</span>
                    <span style={approvalMetaValueStyle}>{dependencyLabel || '无'}</span>
                  </div>
                </div>
                <div style={approvalActionsStyle}>
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={() => onContinueTask(task.id)}
                    disabled={continuingTaskId === task.id}
                  >
                    {continuingTaskId === task.id ? '继续中...' : '继续'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EventsPane({
  events,
  isMobile,
}: {
  events: SummaryEventItem[];
  isMobile: boolean;
}): JSX.Element {
  return (
    <aside style={getEventsPaneStyle(isMobile)} data-testid="summary-events-rail">
      <div style={sectionHeaderStyle}>
        <div>
          <h2 style={sectionTitleStyle}>事件流</h2>
          <p style={sectionHintStyle}>保留最近的实例活动、异常与执行线索。</p>
        </div>
      </div>
      {events.length === 0 ? (
        <div style={emptyStateStyle}>当前没有可展示的事件</div>
      ) : (
        <div style={eventsListStyle}>
          {events.map((event, index) => (
            <article key={`${event.id}:${index}`} style={eventCardStyle}>
              <div style={eventCardHeaderStyle}>
                <span style={eventTypeStyle}>{event.type}</span>
                <span style={eventTimeStyle}>{formatDateTime(event.timestamp)}</span>
              </div>
              <p style={eventInstanceStyle}>
                {event.instanceName}
                {event.agentName ? ` · ${event.agentName}` : ''}
              </p>
              <p style={eventDescriptionStyle}>{event.description}</p>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}

function handleAgentDetailRealtimeMessage(params: {
  message: ObserverRealtimeMessage;
  agentId: string;
  agentName: string;
  instanceName: string;
  appendRealtimeEvent: (item: SummaryEventItem) => void;
}): void {
  const { message, agentId, agentName, instanceName, appendRealtimeEvent } = params;
  if (message.type === 'topology_updated') {
    appendRealtimeEvent(
      toSummaryEventFromObserver({
        id: `topology:${message.channel}:${message.seq}`,
        type: 'topology_updated',
        timestamp: message.timestamp,
        instanceName,
        agentName,
        description: `${agentName} 拓扑已更新`,
      })
    );
    return;
  }
  if (message.type === 'node_events_appended') {
    for (const item of message.payload.events) {
      appendRealtimeEvent(
        toSummaryEventFromObserver({
          id: `node:${agentId}:${item.id}`,
          type: item.type,
          timestamp: item.timestamp,
          instanceName,
          agentName,
          description: item.description,
        })
      );
    }
  }
}

function toSummaryEventFromObserver(item: {
  id: string;
  type: string;
  timestamp: string;
  instanceName: string;
  agentName: string | null;
  description: string;
}): SummaryEventItem {
  return {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp,
    instanceName: item.instanceName,
    agentName: item.agentName,
    description: item.description,
  };
}

function buildInitialEvents(
  events: AggregateOverviewGlobalEvent[],
  currentInstanceId: string | null
): SummaryEventItem[] {
  return events
    .filter((item) => !currentInstanceId || item.instance_id === currentInstanceId)
    .map((item) => ({
      id: item.id,
      type: item.type,
      timestamp: item.timestamp,
      instanceName: item.instance_name,
      agentName: item.agent_name,
      description: item.description,
    }));
}

function EnvelopeErrorSummary({ envelope }: { envelope: ErrorEnvelope }): JSX.Element {
  return (
    <div style={errorMetaListStyle}>
      <p style={errorMetaStyle}>code · {envelope.code}</p>
      <p style={errorMetaStyle}>request_id · {envelope.request_id}</p>
      <p style={errorMetaStyle}>recoverable · {String(envelope.recoverable)}</p>
      {envelope.next_step ? <p style={errorHintStyle}>{envelope.next_step}</p> : null}
    </div>
  );
}

function buildSummaryMetric(tokenGroups: AggregateOverviewTokenGroup[], tasks: KanbanTaskItem[]): SummaryMetric {
  const tokenMetric = buildTokenMetric(tokenGroups);
  if (tokenMetric) {
    return tokenMetric;
  }
  return buildTaskFallbackMetric(tasks);
}

function buildTokenMetric(tokenGroups: AggregateOverviewTokenGroup[]): SummaryMetric | null {
  const usableGroups = tokenGroups.filter((group) => group.samples.length > 0);
  if (usableGroups.length === 0) {
    return null;
  }
  const labels = Array.from(
    new Set(usableGroups.flatMap((group) => group.samples.map((sample) => sample.label)))
  ).sort((left, right) => left.localeCompare(right));
  const series = usableGroups.map((group, index) => {
    const sampleMap = new Map(group.samples.map((sample) => [sample.label, sample.total_tokens]));
    return {
      id: group.instance_id,
      name: group.instance_name,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      values: labels.map((label) => sampleMap.get(label) ?? 0),
    };
  });
  const total = usableGroups.reduce((sum, group) => sum + (group.total_tokens ?? 0), 0);
  return {
    kind: 'tokens',
    title: 'Token 消耗趋势',
    hint: '按实例聚合展示 OpenClaw 最近窗口内的 token 消耗。',
    labels,
    series,
    totalLabel: total > 0 ? `${total.toLocaleString('en-US')} tokens` : '暂无总量',
  };
}

function buildTaskFallbackMetric(tasks: KanbanTaskItem[]): SummaryMetric {
  const buckets = new Map<string, number>();
  for (const task of tasks) {
    const parsed = Date.parse(task.created_at);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const label = new Date(parsed).toLocaleDateString('en-CA');
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }
  const labels = Array.from(buckets.keys()).sort((left, right) => left.localeCompare(right));
  const values = labels.map((label) => buckets.get(label) ?? 0);
  return {
    kind: 'tasks',
    title: '任务节点数量趋势',
    hint: '当前实例未提供 token 统计时，降级展示任务节点数量随时间变化。',
    labels,
    series: labels.length > 0 ? [{ id: 'tasks', name: '任务节点', color: '#0f766e', values }] : [],
    totalLabel: `${tasks.length.toLocaleString('en-US')} 个节点`,
  };
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
}

function formatShortLabel(label: string): string {
  return label.length > 5 ? label.slice(5) : label;
}

const pageStyle: React.CSSProperties = {
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const toolbarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.9rem',
  padding: '0.72rem 1rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(248, 250, 252, 0.82)',
  backdropFilter: 'blur(14px)',
};

const toolbarMobileStyle: React.CSSProperties = {
  flexDirection: 'column',
  alignItems: 'stretch',
};

const toolbarLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.5rem 0.8rem',
};

const toolbarTitleStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: '#10212f',
};

const toolbarMetaStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#52616f',
};

const toolbarActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
};

const contentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  padding: '0.9rem 1rem 1rem',
  minHeight: 0,
};

function getBodyLayoutStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 320px',
    gap: '1rem',
    minHeight: 0,
    alignItems: 'start',
  };
}

const chartCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: '1rem',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(241,245,249,0.78) 100%)',
  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
  padding: '1rem',
};

const chartHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '1rem',
  marginBottom: '0.85rem',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.8rem',
  marginBottom: '0.8rem',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 700,
  color: '#10212f',
};

const sectionHintStyle: React.CSSProperties = {
  margin: '0.2rem 0 0',
  fontSize: '0.78rem',
  color: '#52616f',
  lineHeight: 1.5,
};

const chartTotalBadgeStyle: React.CSSProperties = {
  padding: '0.42rem 0.66rem',
  borderRadius: '999px',
  background: 'rgba(15, 118, 110, 0.1)',
  color: '#0f766e',
  fontSize: '0.78rem',
  fontWeight: 700,
};

const chartLegendStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.55rem 0.8rem',
  marginBottom: '0.75rem',
};

const legendItemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  fontSize: '0.76rem',
  color: '#334155',
};

const legendDotStyle: React.CSSProperties = {
  width: '0.55rem',
  height: '0.55rem',
  borderRadius: '999px',
  display: 'inline-block',
};

const chartViewportStyle: React.CSSProperties = {
  width: '100%',
  height: '220px',
  borderRadius: '0.9rem',
  overflow: 'hidden',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  background: 'rgba(248, 250, 252, 0.86)',
};

const chartSvgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

const chartLabelsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(48px, 1fr))',
  gap: '0.4rem',
  marginTop: '0.55rem',
};

const chartLabelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#64748b',
  textAlign: 'center',
};

const approvalPaneStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: '1rem',
  background: 'rgba(255,255,255,0.82)',
  boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
  padding: '1rem',
  minHeight: '420px',
  display: 'flex',
  flexDirection: 'column',
};

function getEventsPaneStyle(isMobile: boolean): React.CSSProperties {
  return {
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '1rem',
    background: 'rgba(255,255,255,0.78)',
    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    minHeight: isMobile ? '320px' : '420px',
    maxHeight: isMobile ? 'none' : 'calc(100vh - 14rem)',
  };
}

const approvalListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
  minHeight: 0,
  overflowY: 'auto',
  paddingRight: '0.15rem',
};

const approvalCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '0.92rem',
  background: 'rgba(248, 250, 252, 0.92)',
  padding: '0.95rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};

const approvalCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.8rem',
};

const approvalCardTitleWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  minWidth: 0,
};

const approvalBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  width: 'fit-content',
  padding: '0.2rem 0.45rem',
  borderRadius: '999px',
  background: 'rgba(245, 158, 11, 0.12)',
  color: '#b45309',
  fontSize: '0.7rem',
  fontWeight: 700,
};

const approvalCardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#10212f',
  lineHeight: 1.35,
};

const approvalCardMetaStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#64748b',
  whiteSpace: 'nowrap',
};

const approvalDescriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.6,
  color: '#334155',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const approvalMetaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '0.6rem',
};

const approvalMetaItemStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.22rem',
};

const approvalMetaLabelStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#64748b',
};

const approvalMetaValueStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#10212f',
  lineHeight: 1.45,
  wordBreak: 'break-word',
};

const approvalActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const eventsListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.72rem',
  minHeight: 0,
  overflowY: 'auto',
  paddingRight: '0.12rem',
};

const eventCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '0.86rem',
  background: 'rgba(248, 250, 252, 0.9)',
  padding: '0.82rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const eventCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.55rem',
};

const eventTypeStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#0f766e',
  textTransform: 'uppercase',
};

const eventTimeStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  color: '#64748b',
};

const eventInstanceStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
};

const eventDescriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#10212f',
  lineHeight: 1.55,
};

const emptyStateStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  color: '#64748b',
  fontSize: '0.84rem',
  padding: '1rem',
};

const inlineErrorStyle: React.CSSProperties = {
  padding: '0.68rem 0.82rem',
  borderRadius: '0.7rem',
  border: '1px solid rgba(248, 113, 113, 0.24)',
  background: 'rgba(254, 242, 242, 0.88)',
  color: '#b91c1c',
  fontSize: '0.78rem',
  marginBottom: '0.75rem',
};

const fatalErrorCardStyle: React.CSSProperties = {
  border: '1px solid rgba(248, 113, 113, 0.18)',
  borderRadius: '1rem',
  background: 'rgba(255,255,255,0.88)',
  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
  padding: '1.1rem',
  maxWidth: '720px',
};

const fatalErrorTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.1rem',
  color: '#991b1b',
};

const fatalErrorTextStyle: React.CSSProperties = {
  margin: '0.5rem 0 0',
  color: '#7f1d1d',
  lineHeight: 1.6,
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 118, 110, 0.18)',
  background: 'linear-gradient(180deg, #14b8a6 0%, #0f766e 100%)',
  color: '#f8fafc',
  borderRadius: '0.72rem',
  padding: '0.6rem 0.95rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(255,255,255,0.82)',
  color: '#0f172a',
  borderRadius: '0.72rem',
  padding: '0.58rem 0.86rem',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const errorMetaListStyle: React.CSSProperties = {
  marginTop: '0.8rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.22rem',
};

const errorMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#475569',
};

const errorHintStyle: React.CSSProperties = {
  margin: '0.2rem 0 0',
  fontSize: '0.76rem',
  color: '#0f766e',
};
