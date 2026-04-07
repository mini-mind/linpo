import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';
import { useDraggableFab } from '../hooks/useDraggableFab';
import {
  getWorkspaceBodyInnerStyle,
  getWorkspaceBodyShellStyle,
  getWorkspacePageStyle,
  WORKSPACE_CONTENT_MAX_WIDTH_PX,
} from './workspaceLayout';

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
  category: SummaryEventFilter;
  instanceName: string;
  agentName: string | null;
  timestamp: string;
  description: string;
};

type SummaryEventFilter = 'all' | 'approval' | 'execution' | 'topology' | 'agent' | 'exception';
type ApprovalInstanceOption = { id: string; name: string };
type ApprovalTaskView = {
  task: KanbanTaskItem;
  instanceId: string | null;
  instanceName: string;
};

const BOARD_REALTIME_ID = 'default';
const SERIES_COLORS = ['#0f766e', '#0284c7', '#f97316', '#dc2626', '#7c3aed', '#65a30d'];
const EVENTS_PAGE_SIZE = 10;

export function SummaryPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [tasks, setTasks] = useState<KanbanTaskItem[]>([]);
  const [events, setEvents] = useState<SummaryEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<Error | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [continuingTaskId, setContinuingTaskId] = useState<string | null>(null);
  const [approvalInstanceFilter, setApprovalInstanceFilter] = useState('all');
  const [selectedTokenSeriesIds, setSelectedTokenSeriesIds] = useState<string[]>([]);
  const [eventQuery, setEventQuery] = useState('');
  const [eventPage, setEventPage] = useState(1);
  const [isMobileEventsOpen, setIsMobileEventsOpen] = useState(false);
  const boardRealtimeRef = useRef<ReturnType<typeof createBoardTasksSseClient> | null>(null);
  const agentsListRealtimeRef = useRef<ObserverRealtimeClient | null>(null);
  const agentRealtimeRefs = useRef<Map<string, ObserverRealtimeClient>>(new Map());
  const overviewRefreshTimerRef = useRef<number | null>(null);
  const eventsFab = useDraggableFab('linpo.mobile_fab.summary_events', { x: 16, y: 88 });

  const loadOverview = useCallback(async () => {
    try {
      const data = await getAggregateOverview({ disableInstanceContext: true });
      setOverview(data);
      setOverviewError(null);
    } catch (error) {
      setOverviewError(error instanceof Error ? error : new Error('获取摘要失败'));
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const result = await listKanbanTasks({ disableInstanceContext: true }, BOARD_REALTIME_ID);
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

  const aggregateAgentEntries = useMemo(() => {
    const map = new Map<string, { instanceId: string; instanceName: string; agentId: string; agentName: string }>();
    for (const item of overview?.agents ?? []) {
      const instanceId = item.instance_id.trim();
      const agentId = item.agent_id.trim();
      if (!instanceId || !agentId) {
        continue;
      }
      const key = `${instanceId}::${agentId}`;
      if (map.has(key)) {
        continue;
      }
      map.set(key, {
        instanceId,
        instanceName: item.instance_name.trim() || instanceId,
        agentId,
        agentName: item.agent_name.trim() || agentId,
      });
    }
    return Array.from(map.values());
  }, [overview?.agents]);

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
        appendSummaryEvent(setEvents, {
          id: `board-error:${Date.now()}`,
          type: 'error',
          timestamp: new Date().toISOString(),
          instanceName: '全部实例',
          agentName: null,
          description: message.payload.detail || '审批任务实时同步失败',
        });
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

  useEffect(() => {
    if (!overview) {
      return;
    }
    const incoming = buildInitialEvents(overview.global_events);
    setEvents((current) => mergeSummaryEvents(current, incoming));
  }, [overview]);

  const appendRealtimeEvent = useCallback((item: SummaryEventItem) => {
    appendSummaryEvent(setEvents, item);
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
    return () => {
      closeRealtimeConnections();
    };
  }, [closeRealtimeConnections]);

  useEffect(() => {
    const client = createObserverRealtimeClient({
      dataSource: 'openclaw',
      disableInstanceContext: true,
      channel: 'agents:list',
      onMessage: (message) => {
        if (message.type === 'error') {
          appendRealtimeEvent(
            toSummaryEventFromObserver({
              id: `observer-error:${message.channel}:${message.seq}`,
              type: 'error',
              timestamp: message.timestamp,
              instanceName: '全部实例',
              agentName: null,
              description: message.payload.detail || '实例事件订阅失败',
            })
          );
          return;
        }
        if (message.type === 'resync_required') {
          appendRealtimeEvent(
            toSummaryEventFromObserver({
              id: `observer-resync:${message.channel}:${message.seq}`,
              type: 'resync_required',
              timestamp: message.timestamp,
              instanceName: '全部实例',
              agentName: null,
              description: message.payload.reason || '实例事件需要重新同步',
            })
          );
          return;
        }
        if (message.type !== 'agent_summary_updated') {
          return;
        }
        appendRealtimeEvent(
          toSummaryEventFromObserver({
            id: `agent-summary:${message.channel}:${message.seq}`,
            type: 'agent_summary_updated',
            timestamp: message.timestamp,
            instanceName: '全部实例',
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
  }, [appendRealtimeEvent]);

  useEffect(() => {
    const activeSet = new Set(aggregateAgentEntries.map((item) => `${item.instanceId}::${item.agentId}`));
    for (const [agentKey, client] of agentRealtimeRefs.current.entries()) {
      if (!activeSet.has(agentKey)) {
        client.close();
        agentRealtimeRefs.current.delete(agentKey);
      }
    }
    for (const entry of aggregateAgentEntries) {
      const agentKey = `${entry.instanceId}::${entry.agentId}`;
      if (agentRealtimeRefs.current.has(agentKey)) {
        continue;
      }
      const detailClient = createObserverRealtimeClient({
        dataSource: 'openclaw',
        instanceId: entry.instanceId,
        channel: buildAgentDetailChannel(entry.agentId),
        onMessage: (message) => {
          handleAgentDetailRealtimeMessage({
            message,
            agentId: entry.agentId,
            agentName: entry.agentName,
            instanceName: entry.instanceName,
            appendRealtimeEvent,
          });
        },
      });
      detailClient.connect();
      agentRealtimeRefs.current.set(agentKey, detailClient);
    };
  }, [
    aggregateAgentEntries,
    appendRealtimeEvent,
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

  const approvalInstanceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of overview?.diagnostics ?? []) {
      const instanceId = item.instance_id.trim();
      if (!instanceId || map.has(instanceId)) {
        continue;
      }
      const instanceName = item.instance_name.trim() || instanceId;
      map.set(instanceId, instanceName);
    }
    for (const item of overview?.agents ?? []) {
      const instanceId = item.instance_id.trim();
      if (!instanceId || map.has(instanceId)) {
        continue;
      }
      const instanceName = item.instance_name.trim() || instanceId;
      map.set(instanceId, instanceName);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }, [overview?.agents, overview?.diagnostics]);

  const approvalInstanceNameById = useMemo(
    () => new Map(approvalInstanceOptions.map((item) => [item.id, item.name])),
    [approvalInstanceOptions]
  );

  const approvalTaskViews = useMemo<ApprovalTaskView[]>(
    () => approvalTasks.map((task) => ({ task, ...resolveApprovalTaskInstance(task, approvalInstanceNameById) })),
    [approvalInstanceNameById, approvalTasks]
  );

  const filteredApprovalTaskViews = useMemo(() => {
    if (approvalInstanceFilter === 'all') {
      return approvalTaskViews;
    }
    return approvalTaskViews.filter((view) => view.instanceId === approvalInstanceFilter);
  }, [approvalInstanceFilter, approvalTaskViews]);

  useEffect(() => {
    if (approvalInstanceFilter === 'all') {
      return;
    }
    const hasSelectedInstance = approvalInstanceOptions.some((item) => item.id === approvalInstanceFilter);
    if (!hasSelectedInstance) {
      setApprovalInstanceFilter('all');
    }
  }, [approvalInstanceFilter, approvalInstanceOptions]);

  const metric = useMemo(
    () => buildSummaryMetric(overview?.token_groups ?? [], tasks),
    [overview?.token_groups, tasks]
  );

  useEffect(() => {
    if (metric.kind !== 'tokens' || metric.series.length === 0) {
      setSelectedTokenSeriesIds([]);
      return;
    }
    const availableIds = metric.series.map((item) => item.id);
    setSelectedTokenSeriesIds((current) => {
      const next = current.filter((id) => availableIds.includes(id));
      if (next.length > 0) {
        return next;
      }
      return availableIds;
    });
  }, [metric]);

  const toggleTokenSeries = useCallback((seriesId: string) => {
    setSelectedTokenSeriesIds((current) => {
      if (!current.includes(seriesId)) {
        return [...current, seriesId];
      }
      if (current.length <= 1) {
        return current;
      }
      return current.filter((id) => id !== seriesId);
    });
  }, []);

  const filteredEvents = useMemo(() => events.filter((item) => matchesEventQuery(item, eventQuery)), [eventQuery, events]);
  const totalEventPages = Math.max(1, Math.ceil(filteredEvents.length / EVENTS_PAGE_SIZE));
  const pagedEvents = useMemo(() => {
    const start = (eventPage - 1) * EVENTS_PAGE_SIZE;
    return filteredEvents.slice(start, start + EVENTS_PAGE_SIZE);
  }, [eventPage, filteredEvents]);

  useEffect(() => {
    setEventPage(1);
  }, [eventQuery]);

  useEffect(() => {
    setEventPage((current) => Math.min(current, totalEventPages));
  }, [totalEventPages]);

  const handleContinueTask = useCallback(
    async (taskId: string, instanceId?: string | null) => {
      try {
        setContinuingTaskId(taskId);
        await continueKanbanTask(taskId, { instanceId: instanceId ?? null }, BOARD_REALTIME_ID);
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
      <section style={getWorkspacePageStyle({ extra: summaryPageStyle })} data-testid="summary-page">
        <div style={getWorkspaceBodyShellStyle({ isMobile, extra: isMobile ? bodyShellMobileStyle : bodyShellStyle })}>
          <div style={getWorkspaceBodyInnerStyle({ isMobile, maxWidthPx: WORKSPACE_CONTENT_MAX_WIDTH_PX, extra: getBodyStyle(isMobile) })} data-testid="summary-content-frame">
            <div style={getContentStyle(isMobile)}>
              <section style={getChartCardStyle(isMobile)}>正在加载统计曲线…</section>
              <div style={getBodyLayoutStyle(isMobile)}>
                <section style={getApprovalPaneStyle(isMobile)}>正在加载审批项…</section>
                <aside style={getEventsPaneStyle(isMobile)}>正在加载事件流…</aside>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (overviewError && !overview) {
    const envelope = overviewError instanceof ApiError ? overviewError.envelope : null;
    return (
      <section style={getWorkspacePageStyle({ extra: summaryPageStyle })} data-testid="summary-page">
        <div style={getWorkspaceBodyShellStyle({ isMobile, extra: isMobile ? bodyShellMobileStyle : bodyShellStyle })}>
          <div style={getWorkspaceBodyInnerStyle({ isMobile, maxWidthPx: WORKSPACE_CONTENT_MAX_WIDTH_PX, extra: getBodyStyle(isMobile) })} data-testid="summary-content-frame">
            <div style={getContentStyle(isMobile)}>
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
        </div>
      </section>
    );
  }

  return (
    <section style={getWorkspacePageStyle({ extra: summaryPageStyle })} data-testid="summary-page">
      {isMobile ? (
        <button
          type="button"
          style={{ ...mobileEventsFabStyle, left: `${eventsFab.position.x}px`, top: `${eventsFab.position.y}px`, touchAction: 'none' }}
          aria-label="打开事件流"
          onPointerDown={eventsFab.handlePointerDown}
          onClick={(event) => {
            if (!eventsFab.consumeClickIfDragged(event)) {
              return;
            }
            setIsMobileEventsOpen(true);
          }}
        >
          事件流
        </button>
      ) : null}
      {isMobile && isMobileEventsOpen ? (
        <div
          style={mobileEventsOverlayStyle}
          role="dialog"
          aria-modal="true"
          aria-label="摘要事件流"
          onClick={() => setIsMobileEventsOpen(false)}
        >
          <div style={mobileEventsDialogStyle} onClick={(event) => event.stopPropagation()}>
            <div style={mobileEventsDialogHeaderStyle}>
              <h3 style={mobileEventsDialogTitleStyle}>事件流</h3>
              <button type="button" style={mobileEventsDialogCloseStyle} onClick={() => setIsMobileEventsOpen(false)}>
                关闭
              </button>
            </div>
            <EventsPane
              events={pagedEvents}
              totalCount={events.length}
              filteredCount={filteredEvents.length}
              currentPage={eventPage}
              totalPages={totalEventPages}
              query={eventQuery}
              isMobile
              onQueryChange={setEventQuery}
              onPrevPage={() => setEventPage((current) => Math.max(1, current - 1))}
              onNextPage={() => setEventPage((current) => Math.min(totalEventPages, current + 1))}
            />
          </div>
        </div>
      ) : null}
      <div style={getWorkspaceBodyShellStyle({ isMobile, extra: isMobile ? bodyShellMobileStyle : bodyShellStyle })}>
        <div style={getWorkspaceBodyInnerStyle({ isMobile, maxWidthPx: WORKSPACE_CONTENT_MAX_WIDTH_PX, extra: getBodyStyle(isMobile) })} data-testid="summary-content-frame">
          <div style={getContentStyle(isMobile)}>
            <SummaryChart
              metric={metric}
              isMobile={isMobile}
              selectedSeriesIds={selectedTokenSeriesIds}
              onToggleSeries={toggleTokenSeries}
            />
            <div style={getBodyLayoutStyle(isMobile)}>
              <ApprovalPane
                approvalTaskViews={filteredApprovalTaskViews}
                approvalInstanceFilter={approvalInstanceFilter}
                approvalInstanceOptions={approvalInstanceOptions}
                tasksError={tasksError}
                continuingTaskId={continuingTaskId}
                onContinueTask={handleContinueTask}
                onApprovalInstanceFilterChange={setApprovalInstanceFilter}
                isMobile={isMobile}
              />
              {!isMobile ? (
                <EventsPane
                  events={pagedEvents}
                  totalCount={events.length}
                  filteredCount={filteredEvents.length}
                  currentPage={eventPage}
                  totalPages={totalEventPages}
                  query={eventQuery}
                  isMobile={isMobile}
                  onQueryChange={setEventQuery}
                  onPrevPage={() => setEventPage((current) => Math.max(1, current - 1))}
                  onNextPage={() => setEventPage((current) => Math.min(totalEventPages, current + 1))}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryChart({
  metric,
  isMobile,
  selectedSeriesIds,
  onToggleSeries,
}: {
  metric: SummaryMetric;
  isMobile: boolean;
  selectedSeriesIds: string[];
  onToggleSeries: (seriesId: string) => void;
}): JSX.Element {
  const visibleSeries = metric.kind === 'tokens'
    ? metric.series.filter((item) => selectedSeriesIds.includes(item.id))
    : metric.series;
  const chartSeries = visibleSeries.length > 0 ? visibleSeries : metric.series;
  const maxValue = Math.max(1, ...chartSeries.flatMap((item) => item.values));
  const pointCount = Math.max(1, metric.labels.length - 1);
  const viewBoxWidth = 100;
  const viewBoxHeight = 36;
  const visibleLabels = getVisibleMetricLabels(metric.labels, isMobile);

  return (
    <section style={getChartCardStyle(isMobile)} data-testid="summary-chart">
      <div style={getChartHeaderStyle(isMobile)}>
        <div>
          <h2 style={sectionTitleStyle}>{metric.title}</h2>
          {metric.kind === 'tokens' ? null : <p style={sectionHintStyle}>{metric.hint}</p>}
        </div>
        <div style={chartTotalBadgeStyle}>{metric.totalLabel}</div>
      </div>

      {metric.labels.length === 0 || metric.series.length === 0 ? (
        <div style={emptyStateStyle}>当前没有可展示的统计样本</div>
      ) : (
        <>
          {metric.kind === 'tokens' ? (
            <div style={tokenSeriesFilterWrapStyle} role="group" aria-label="Token 曲线实例筛选">
              {metric.series.map((item) => {
                const checked = selectedSeriesIds.includes(item.id);
                return (
                  <label key={item.id} style={{ ...tokenSeriesFilterItemStyle, color: item.color }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSeries(item.id)}
                      style={{ ...tokenSeriesFilterCheckboxStyle, accentColor: item.color }}
                      aria-label={`切换${item.name}曲线`}
                      data-testid={`summary-series-toggle-${toSeriesTestId(item.id)}`}
                    />
                    <span>{item.name}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
          {metric.kind === 'tokens' ? null : (
            <div style={chartLegendStyle}>
              {chartSeries.map((item) => (
                <span key={item.id} style={legendItemStyle}>
                  <span style={{ ...legendDotStyle, background: item.color }} />
                  {item.name}
                </span>
              ))}
            </div>
          )}
          <div style={getChartViewportStyle(isMobile)}>
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
              {chartSeries.map((item) => {
                const points = item.values
                  .map((value, index) => {
                    const x = pointCount === 0 ? 0 : (index / pointCount) * viewBoxWidth;
                    const y = viewBoxHeight - 4 - (value / maxValue) * (viewBoxHeight - 8);
                    return `${x},${y}`;
                  })
                  .join(' ');
                return (
                  <g key={item.id} data-testid={`summary-series-${toSeriesTestId(item.id)}`}>
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
            {visibleLabels.map((label) => (
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
  approvalTaskViews,
  approvalInstanceFilter,
  approvalInstanceOptions,
  tasksError,
  continuingTaskId,
  onContinueTask,
  onApprovalInstanceFilterChange,
  isMobile,
}: {
  approvalTaskViews: ApprovalTaskView[];
  approvalInstanceFilter: string;
  approvalInstanceOptions: ApprovalInstanceOption[];
  tasksError: string | null;
  continuingTaskId: string | null;
  onContinueTask: (taskId: string, instanceId?: string | null) => void;
  onApprovalInstanceFilterChange: (value: string) => void;
  isMobile: boolean;
}): JSX.Element {
  return (
    <section style={getApprovalPaneStyle(isMobile)} data-testid="summary-approval-list">
      <div style={getSectionHeaderStyle(isMobile)}>
        <div>
          <h2 style={sectionTitleStyle}>审批项</h2>
          <p style={sectionHintStyle}>集中处理被敏感操作阻塞的任务节点。</p>
        </div>
        <label style={approvalFilterWrapStyle}>
          <span style={srOnlyStyle}>筛选审批实例</span>
          <select
            aria-label="筛选审批实例"
            value={approvalInstanceFilter}
            onChange={(event) => onApprovalInstanceFilterChange(event.target.value)}
            style={approvalFilterSelectStyle}
          >
            <option value="all">全部实例</option>
            {approvalInstanceOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tasksError ? <div style={inlineErrorStyle}>{tasksError}</div> : null}
      {approvalTaskViews.length === 0 ? (
        <div style={emptyStateStyle}>当前没有待审批任务</div>
      ) : (
        <div style={getApprovalListStyle(isMobile)}>
          {approvalTaskViews.map((view) => {
            const task = view.task;
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
                    onClick={() => onContinueTask(task.id, view.instanceId ?? task.instance_id)}
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

function resolveApprovalTaskInstance(
  task: KanbanTaskItem,
  approvalInstanceNameById: Map<string, string>
): { instanceId: string | null; instanceName: string } {
  const normalizedTaskInstanceId = normalizeOptionalString(task.instance_id);
  const normalizedExtrasInstanceId = normalizeOptionalString(task.extras.instance_id);
  const instanceId = normalizedTaskInstanceId ?? normalizedExtrasInstanceId;
  const backendInstanceName = instanceId ? normalizeOptionalString(approvalInstanceNameById.get(instanceId)) : null;
  const instanceName =
    backendInstanceName
    ?? normalizeOptionalString(task.extras.instance_name)
    ?? instanceId
    ?? '未标识实例';
  return {
    instanceId: instanceId ?? null,
    instanceName,
  };
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function toSeriesTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function EventsPane({
  events,
  totalCount,
  filteredCount,
  currentPage,
  totalPages,
  query,
  isMobile,
  onQueryChange,
  onPrevPage,
  onNextPage,
}: {
  events: SummaryEventItem[];
  totalCount: number;
  filteredCount: number;
  currentPage: number;
  totalPages: number;
  query: string;
  isMobile: boolean;
  onQueryChange: (value: string) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}): JSX.Element {
  return (
    <aside style={getEventsPaneStyle(isMobile)} data-testid="summary-events-rail">
      <div style={getSectionHeaderStyle(isMobile)}>
        <div>
          <h2 style={sectionTitleStyle}>事件流</h2>
          <p style={sectionHintStyle}>
            保留最近的实例活动、异常与执行线索。
            {totalCount > filteredCount ? ` 当前筛选后 ${filteredCount}/${totalCount} 条。` : ''}
          </p>
        </div>
      </div>
      <div style={eventsToolbarStyle}>
        <label style={eventSearchWrapStyle}>
          <span style={srOnlyStyle}>筛选事件关键字</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="筛选关键字"
            style={eventSearchInputStyle}
          />
        </label>
      </div>
      {events.length === 0 ? (
        <div style={emptyStateStyle}>当前没有可展示的事件</div>
      ) : (
        <div style={getEventsListStyle(isMobile)}>
          {events.map((event) => {
            return (
              <article key={event.id} style={eventCardStyle}>
                <div style={eventCardBodyStyle}>
                  <div style={eventCardHeaderStyle}>
                    <span style={getEventTypeStyle(event.category)}>{getEventTypeLabel(event)}</span>
                    <span style={eventTimeStyle}>{formatDateTime(event.timestamp)}</span>
                  </div>
                  <p style={eventInstanceStyle}>
                    {event.instanceName}
                    {event.agentName ? ` · ${event.agentName}` : ''}
                  </p>
                  <p style={eventDescriptionStyle}>{event.description}</p>
                  <div style={eventExpandedMetaStyle}>
                    <span style={eventMetaPillStyle}>类别 · {getEventFilterLabel(event.category)}</span>
                    <span style={eventMetaPillStyle}>类型 · {event.type}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div style={eventsPaginationStyle}>
        <button type="button" style={ghostButtonStyle} onClick={onPrevPage} disabled={currentPage <= 1}>
          上一页
        </button>
        <span style={paginationTextStyle}>
          第 {currentPage} / {totalPages} 页
        </span>
        <button type="button" style={ghostButtonStyle} onClick={onNextPage} disabled={currentPage >= totalPages}>
          下一页
        </button>
      </div>
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
  if (message.type === 'error') {
    appendRealtimeEvent(
      toSummaryEventFromObserver({
        id: `detail-error:${message.channel}:${message.seq}`,
        type: 'error',
        timestamp: message.timestamp,
        instanceName,
        agentName,
        description: message.payload.detail || `${agentName} 事件订阅失败`,
      })
    );
    return;
  }
  if (message.type === 'resync_required') {
    appendRealtimeEvent(
      toSummaryEventFromObserver({
        id: `detail-resync:${message.channel}:${message.seq}`,
        type: 'resync_required',
        timestamp: message.timestamp,
        instanceName,
        agentName,
        description: message.payload.reason || `${agentName} 事件需要重新同步`,
      })
    );
    return;
  }
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
    category: classifyEvent(item.type, item.description),
    timestamp: item.timestamp,
    instanceName: item.instanceName,
    agentName: item.agentName,
    description: item.description,
  };
}

function buildInitialEvents(events: AggregateOverviewGlobalEvent[]): SummaryEventItem[] {
  return events
    .map((item) => ({
      id: item.id,
      type: item.type,
      category: classifyEvent(item.type, item.description),
      timestamp: item.timestamp,
      instanceName: item.instance_name,
      agentName: item.agent_name,
      description: item.description,
    }));
}

function classifyEvent(type: string, description: string): SummaryEventFilter {
  const normalized = `${type} ${description}`.toLowerCase();
  if (
    normalized.includes('error') ||
    normalized.includes('failed') ||
    normalized.includes('异常') ||
    normalized.includes('错误') ||
    normalized.includes('resync')
  ) {
    return 'exception';
  }
  if (
    normalized.includes('approval') ||
    normalized.includes('approve') ||
    normalized.includes('审批') ||
    normalized.includes('blocked_by_approval')
  ) {
    return 'approval';
  }
  if (normalized.includes('topology') || normalized.includes('拓扑')) {
    return 'topology';
  }
  if (
    normalized.includes('agent_summary') ||
    normalized.includes('agent_created') ||
    normalized.includes('subagent_created') ||
    normalized.includes('status_changed')
  ) {
    return 'agent';
  }
  return 'execution';
}

function appendSummaryEvent(
  setEvents: React.Dispatch<React.SetStateAction<SummaryEventItem[]>>,
  item: Omit<SummaryEventItem, 'category'> & { category?: SummaryEventFilter }
): void {
  setEvents((current) =>
    mergeSummaryEvents(current, [
      {
        ...item,
        category: item.category ?? classifyEvent(item.type, item.description),
      },
    ])
  );
}

function mergeSummaryEvents(current: SummaryEventItem[], incoming: SummaryEventItem[]): SummaryEventItem[] {
  const map = new Map<string, SummaryEventItem>();
  for (const item of [...incoming, ...current]) {
    map.set(item.id, item);
  }
  return sortSummaryEvents([...map.values()]);
}

function sortSummaryEvents(events: SummaryEventItem[]): SummaryEventItem[] {
  const next = [...events];
  next.sort((left, right) => {
    const leftTs = Date.parse(left.timestamp);
    const rightTs = Date.parse(right.timestamp);
    return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
  });
  return next.slice(0, 80);
}

function matchesEventQuery(item: SummaryEventItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const haystack = [
    item.type,
    item.description,
    item.instanceName,
    item.agentName ?? '',
    getEventTypeLabel(item),
    getEventFilterLabel(item.category),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

function getEventTypeLabel(item: SummaryEventItem): string {
  const known: Record<string, string> = {
    agent_created: 'Agent 创建',
    subagent_created: '子 Agent 创建',
    activity_started: '开始执行',
    activity_stopped: '停止执行',
    status_changed: '状态更新',
    node_finished: '节点完成',
    task_started: '任务开始',
    task_finished: '任务结束',
    task_interrupted: '任务中断',
    topology_updated: '拓扑更新',
    agent_summary_updated: 'Agent 更新',
    resync_required: '需要重同步',
    error: '异常',
  };
  return known[item.type] ?? item.type;
}

function getEventFilterLabel(value: SummaryEventFilter): string {
  const labels: Record<SummaryEventFilter, string> = {
    all: '全部',
    approval: '审批',
    execution: '执行',
    topology: '拓扑',
    agent: 'Agent',
    exception: '异常',
  };
  return labels[value] ?? value;
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

function buildSummaryMetric(
  tokenGroups: AggregateOverviewTokenGroup[],
  tasks: KanbanTaskItem[]
): SummaryMetric {
  const tokenMetric = buildTokenMetric(tokenGroups);
  if (tokenMetric) {
    return tokenMetric;
  }
  return buildTaskFallbackMetric(tasks);
}

function buildTokenMetric(tokenGroups: AggregateOverviewTokenGroup[]): SummaryMetric | null {
  const mergedGroups = mergeTokenGroups(tokenGroups);
  const labels = Array.from(
    new Set(mergedGroups.flatMap((group) => group.samples.map((sample) => sample.label)))
  ).sort((left, right) => left.localeCompare(right));
  if (labels.length === 0) {
    return null;
  }
  const aggregateSampleMap = new Map<string, number>();
  const instanceSeries = mergedGroups.map((group, index) => {
    const sampleMap = new Map(group.samples.map((sample) => [sample.label, sample.total_tokens]));
    for (const [label, totalTokens] of sampleMap.entries()) {
      aggregateSampleMap.set(label, (aggregateSampleMap.get(label) ?? 0) + totalTokens);
    }
    return {
      id: group.instance_id,
      name: group.instance_name,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      values: labels.map((label) => sampleMap.get(label) ?? 0),
    };
  });
  const series = [
    {
      id: 'aggregate:all-instances',
      name: '全部实例',
      color: '#0f172a',
      values: labels.map((label) => aggregateSampleMap.get(label) ?? 0),
    },
    ...instanceSeries,
  ];
  const total = mergedGroups.reduce((sum, group) => sum + (group.total_tokens ?? 0), 0);
  return {
    kind: 'tokens',
    title: 'Token 消耗趋势',
    hint: '默认展示全部实例聚合曲线，并保留各实例走势对比。',
    labels,
    series,
    totalLabel: total > 0 ? `${total.toLocaleString('en-US')} tokens` : '暂无总量',
  };
}

function mergeTokenGroups(tokenGroups: AggregateOverviewTokenGroup[]): AggregateOverviewTokenGroup[] {
  const mergedGroups = new Map<
    string,
    {
      instance_id: string;
      instance_name: string;
      total_tokens: number | null;
      samples: Map<string, { label: string; input_tokens: number; output_tokens: number; total_tokens: number }>;
    }
  >();

  tokenGroups.forEach((group, index) => {
    const normalizedInstanceId = group.instance_id.trim();
    const normalizedInstanceName = group.instance_name.trim() || normalizedInstanceId || `实例 ${index + 1}`;
    const key = normalizedInstanceId || normalizedInstanceName;
    const existing = mergedGroups.get(key) ?? {
      instance_id: normalizedInstanceId || `instance-${index + 1}`,
      instance_name: normalizedInstanceName,
      total_tokens: 0,
      samples: new Map<string, { label: string; input_tokens: number; output_tokens: number; total_tokens: number }>(),
    };

    existing.instance_name = existing.instance_name || normalizedInstanceName;
    existing.total_tokens = (existing.total_tokens ?? 0) + (group.total_tokens ?? 0);

    for (const sample of group.samples) {
      const current = existing.samples.get(sample.label) ?? {
        label: sample.label,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };
      current.input_tokens += sample.input_tokens;
      current.output_tokens += sample.output_tokens;
      current.total_tokens += sample.total_tokens;
      existing.samples.set(sample.label, current);
    }

    mergedGroups.set(key, existing);
  });

  return Array.from(mergedGroups.values()).map((group) => ({
    instance_id: group.instance_id,
    instance_name: group.instance_name,
    total_tokens:
      group.total_tokens !== null
        ? group.total_tokens
        : Array.from(group.samples.values()).reduce((sum, sample) => sum + sample.total_tokens, 0),
    samples: Array.from(group.samples.values()).sort((left, right) => left.label.localeCompare(right.label)),
  }));
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

function getVisibleMetricLabels(labels: string[], isMobile: boolean): string[] {
  if (!isMobile || labels.length <= 4) {
    return labels;
  }
  const next = labels.filter((_, index) => index === 0 || index === labels.length - 1 || index % 2 === 1);
  return next.length > 0 ? next : labels;
}

const summaryPageStyle: React.CSSProperties = {
  minHeight: '100%',
  height: 'auto',
  overflow: 'visible',
};

const bodyShellStyle: React.CSSProperties = {
  flex: '0 0 auto',
};

const bodyShellMobileStyle: React.CSSProperties = {
  flex: '0 0 auto',
};

const mobileEventsFabStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 70,
  border: '1px solid rgba(14, 116, 144, 0.42)',
  borderRadius: '999px',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  fontSize: '0.78rem',
  fontWeight: 700,
  padding: '0.52rem 0.84rem',
  boxShadow: '0 12px 24px -22px rgba(15, 23, 42, 0.95)',
  cursor: 'pointer',
};

const mobileEventsOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 75,
  background: 'rgba(15, 23, 42, 0.28)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  padding: '0.9rem 0.6rem 0.6rem',
};

const mobileEventsDialogStyle: React.CSSProperties = {
  width: 'min(92vw, 440px)',
  maxWidth: '100%',
  maxHeight: 'calc(100vh - 1.5rem)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const mobileEventsDialogHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.55rem',
};

const mobileEventsDialogTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  fontWeight: 700,
  color: '#f8fafc',
};

const mobileEventsDialogCloseStyle: React.CSSProperties = {
  border: '1px solid rgba(226, 232, 240, 0.44)',
  background: 'rgba(15, 23, 42, 0.4)',
  color: '#e2e8f0',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.58rem',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

function getContentStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: isMobile ? '0.85rem' : '1rem',
    padding: isMobile ? '0.72rem 0 0.9rem' : '0.9rem 0 1rem',
    minHeight: 0,
  };
}

function getBodyStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: '100%',
    maxWidth: isMobile ? '100%' : `${WORKSPACE_CONTENT_MAX_WIDTH_PX}px`,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 auto',
    overflow: 'visible',
  };
}

function getBodyLayoutStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.35fr) minmax(320px, 360px)',
    gap: '1rem',
    minHeight: 0,
    alignItems: 'start',
  };
}

function getChartCardStyle(isMobile: boolean): React.CSSProperties {
  return {
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '1rem',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(241,245,249,0.78) 100%)',
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
    padding: isMobile ? '0.88rem' : '1rem',
  };
}

function getChartHeaderStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    alignItems: isMobile ? 'stretch' : 'flex-start',
    justifyContent: 'space-between',
    gap: '0.72rem',
    marginBottom: '0.85rem',
  };
}

function getSectionHeaderStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    alignItems: isMobile ? 'stretch' : 'flex-start',
    justifyContent: 'space-between',
    gap: '0.8rem',
    marginBottom: '0.8rem',
  };
}

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

const tokenSeriesFilterWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.45rem 0.7rem',
  marginBottom: '0.65rem',
};

const tokenSeriesFilterItemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  fontSize: '0.74rem',
  color: '#334155',
};

const tokenSeriesFilterCheckboxStyle: React.CSSProperties = {
  width: '0.86rem',
  height: '0.86rem',
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

function getChartViewportStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: '100%',
    height: isMobile ? '176px' : '220px',
    borderRadius: '0.9rem',
    overflow: 'hidden',
    border: '1px solid rgba(148, 163, 184, 0.16)',
    background: 'rgba(248, 250, 252, 0.86)',
  };
}

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

function getApprovalPaneStyle(isMobile: boolean): React.CSSProperties {
  return {
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '1rem',
    background: 'rgba(255,255,255,0.82)',
    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
    padding: isMobile ? '0.88rem' : '1rem',
    minHeight: isMobile ? '280px' : '420px',
    maxHeight: isMobile ? '56vh' : 'calc(100vh - 14rem)',
    display: 'flex',
    flexDirection: 'column',
  };
}

function getEventsPaneStyle(isMobile: boolean): React.CSSProperties {
  return {
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '1rem',
    background: 'rgba(255,255,255,0.78)',
    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
    padding: isMobile ? '0.88rem' : '1rem',
    display: 'flex',
    flexDirection: 'column',
    minHeight: isMobile ? '300px' : '420px',
    maxHeight: isMobile ? '60vh' : 'calc(100vh - 14rem)',
  };
}

function getApprovalListStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.9rem',
    minHeight: 0,
    overflowY: 'auto',
    paddingRight: isMobile ? 0 : '0.15rem',
  };
}

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

const approvalFilterWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
};

const approvalFilterSelectStyle: React.CSSProperties = {
  minWidth: '140px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.78rem',
  background: 'rgba(255, 255, 255, 0.92)',
  color: '#10212f',
  fontSize: '0.78rem',
  padding: '0.5rem 0.72rem',
  outline: 'none',
};

const eventsToolbarStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  marginBottom: '0.8rem',
};

function getEventsListStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.72rem',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    paddingRight: isMobile ? 0 : '0.12rem',
  };
}

const eventCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '0.86rem',
  background: 'rgba(248, 250, 252, 0.9)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const eventCardBodyStyle: React.CSSProperties = {
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

function getEventTypeStyle(category: SummaryEventFilter): React.CSSProperties {
  const palette: Record<SummaryEventFilter, { bg: string; text: string }> = {
    all: { bg: 'rgba(15, 118, 110, 0.1)', text: '#0f766e' },
    approval: { bg: 'rgba(245, 158, 11, 0.12)', text: '#b45309' },
    execution: { bg: 'rgba(2, 132, 199, 0.12)', text: '#0369a1' },
    topology: { bg: 'rgba(99, 102, 241, 0.12)', text: '#4f46e5' },
    agent: { bg: 'rgba(34, 197, 94, 0.12)', text: '#15803d' },
    exception: { bg: 'rgba(239, 68, 68, 0.12)', text: '#b91c1c' },
  };
  const tone = palette[category];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.16rem 0.44rem',
    borderRadius: '999px',
    background: tone.bg,
    color: tone.text,
    fontSize: '0.68rem',
    fontWeight: 700,
  };
}

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

const eventExpandedMetaStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.45rem',
  paddingTop: '0.18rem',
};

const eventMetaPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.18rem 0.45rem',
  borderRadius: '999px',
  background: 'rgba(226, 232, 240, 0.65)',
  color: '#475569',
  fontSize: '0.68rem',
  fontWeight: 600,
};

const eventSearchWrapStyle: React.CSSProperties = {
  display: 'block',
};

const eventSearchInputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.78rem',
  background: 'rgba(255, 255, 255, 0.92)',
  color: '#10212f',
  fontSize: '0.8rem',
  padding: '0.58rem 0.72rem',
  outline: 'none',
};

const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
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

const eventsPaginationStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  marginTop: '0.8rem',
  paddingTop: '0.8rem',
  borderTop: '1px solid rgba(148, 163, 184, 0.16)',
};

const paginationTextStyle: React.CSSProperties = {
  fontSize: '0.76rem',
  color: '#52616f',
  fontWeight: 600,
  whiteSpace: 'nowrap',
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
