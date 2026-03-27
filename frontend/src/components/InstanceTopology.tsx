import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { ApiError, getAggregateTopology, getDefaultObserverDataSource } from "../api/client";
import { createObserverRealtimeClient } from "../api/realtimeClient";
import type {
  AggregateTopologyResponse,
  AggregateTopologyToolItem,
  ErrorEnvelope,
  EventRecord,
} from "../api/types";
import { buildAgentDetailChannel } from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";
import { buildSessionEntryPath } from "./SessionPage";

type TopologyLane = "instance" | "agent" | "session" | "tool";

type TopologyNodeAction = {
  kind: "enter" | "fallback" | "disabled";
  statusLabel: string;
  detail: string;
  actionLabel?: string;
  href?: string;
};

type GatewayTraceNodeKind =
  | "gateway"
  | "client"
  | "rpc"
  | "session"
  | "agent"
  | "tool"
  | "channel"
  | "node"
  | (string & {});

type GatewayTraceNode = {
  kind: GatewayTraceNodeKind;
  id: string;
  label?: string;
};

type GatewayTraceEvent = {
  id: string;
  ts: number;
  kind: string;
  from: GatewayTraceNode;
  to: GatewayTraceNode;
  label?: string;
  sessionKey?: string;
  runId?: string;
  data?: Record<string, unknown>;
};

type RoutingFilters = {
  rpc: boolean;
  messages: boolean;
  tools: boolean;
};

type GraphNode = {
  key: string;
  kind: string;
  id: string;
  label: string;
  lastTs: number;
  lastAnimatedTs: number | null;
  activity: number;
  x: number;
  y: number;
};

type GraphEdge = {
  key: string;
  kind: string;
  label: string | null;
  fromKey: string;
  toKey: string;
  count: number;
  lastTs: number;
  lastAnimatedTs: number | null;
};

type RealtimeState = "connecting" | "realtime" | "disconnected" | "error" | "paused";

type GraphCamera = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

type GraphSceneBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type NodeDetailRow = {
  label: string;
  value: string;
};

type NodeDetailState = {
  title: string;
  subtitle: string;
  rows: NodeDetailRow[];
  action?: TopologyNodeAction;
  linkTestId?: string;
};

const GRAPH_W = 1920;
const GRAPH_H = 1080;
const GRAPH_PAD = 40;
const GRAPH_HIGHLIGHT_MS = 7000;
const EDGE_LIMIT = 120;
const POLL_INTERVAL_MS = 5000;
const REALTIME_REFRESH_THROTTLE_MS = 750;
const DEFAULT_GRAPH_CAMERA: GraphCamera = { scale: 1, offsetX: 0, offsetY: 0 };
const MIN_GRAPH_SCALE = 0.12;
const MAX_GRAPH_SCALE = 8;
const NODE_DRAG_EXTRA_X = GRAPH_W * 4;
const NODE_DRAG_EXTRA_Y = GRAPH_H * 4;
const WHEEL_ZOOM_SPEED = 1.1;

const WINDOW_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 2, label: "2 分钟" },
  { value: 5, label: "5 分钟" },
  { value: 10, label: "10 分钟" },
  { value: 30, label: "30 分钟" },
];

const GRAPH_X_BY_GROUP: Record<string, number> = {
  client: 240,
  gateway: 420,
  rpc: 620,
  agent: 920,
  tool: 1220,
  session: 1540,
  channel: 1740,
  node: 1820,
  other: 1740,
};

const GRAPH_Y_RANGES_BY_GROUP: Record<string, { top: number; bottom: number }> = {
  client: { top: GRAPH_PAD, bottom: GRAPH_H - GRAPH_PAD },
  gateway: { top: GRAPH_PAD, bottom: GRAPH_H - GRAPH_PAD },
  rpc: { top: GRAPH_PAD, bottom: GRAPH_H - GRAPH_PAD },
  agent: { top: GRAPH_PAD + 16, bottom: GRAPH_H * 0.46 },
  session: { top: GRAPH_PAD + 6, bottom: GRAPH_H * 0.62 },
  tool: { top: GRAPH_H * 0.62, bottom: GRAPH_H - GRAPH_PAD - 10 },
  channel: { top: GRAPH_PAD + 10, bottom: GRAPH_H - GRAPH_PAD },
  node: { top: GRAPH_PAD + 10, bottom: GRAPH_H - GRAPH_PAD },
  other: { top: GRAPH_PAD, bottom: GRAPH_H - GRAPH_PAD },
};

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value == null) return "";
  return String(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildEdgeCurvePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const horizontal = Math.abs(to.x - from.x);
  const curveX = Math.max(72, horizontal * 0.42);
  return `M ${from.x} ${from.y} C ${from.x + curveX} ${from.y}, ${to.x - curveX} ${to.y}, ${to.x} ${to.y}`;
}

function parseIsoTimestamp(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : fallback;
}

function friendlyNodeKind(kind: string): string {
  if (kind === "client") return "入口";
  if (kind === "gateway") return "网关";
  if (kind === "rpc") return "RPC";
  if (kind === "agent") return "智能体";
  if (kind === "tool") return "工具";
  if (kind === "session") return "会话";
  if (kind === "channel") return "渠道";
  if (kind === "node") return "设备";
  return "其他";
}

function formatNodeLabel(node: GatewayTraceNode): string {
  return (node.label?.trim() || node.id || "unknown").slice(0, 64);
}

function formatAbsoluteTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalizeNodeLabel(node: GatewayTraceNode): string {
  const label = typeof node.label === "string" ? node.label.trim() : "";
  const id = safeString(node.id).trim();
  return label || id || "(unknown)";
}

function nodeKey(node: GatewayTraceNode): string {
  return `${safeString(node.kind)}:${safeString(node.id)}`;
}

function inferGatewayAddress(): string {
  if (typeof window === "undefined") return "127.0.0.1";
  const host = window.location.hostname?.trim();
  if (!host || host === "localhost") return "127.0.0.1";
  return host;
}

function stableNodeRef(primary: string | null | undefined, fallback: string | null | undefined): string {
  const normalizedPrimary = safeString(primary).trim();
  if (normalizedPrimary) return normalizedPrimary;
  return safeString(fallback).trim();
}

function iconPathForNodeKind(kind: string): string {
  if (kind === "client") return "/assets/openclaw-icon.png";
  if (kind === "gateway") return "/assets/topology-icons/gateway.svg";
  if (kind === "rpc") return "/assets/topology-icons/rpc.svg";
  if (kind === "agent") return "/assets/topology-icons/agent.svg";
  if (kind === "tool") return "/assets/topology-icons/tool.svg";
  if (kind === "session") return "/assets/topology-icons/session.svg";
  if (kind === "channel") return "/assets/topology-icons/channel.svg";
  if (kind === "node") return "/assets/topology-icons/node.svg";
  return "/assets/topology-icons/other.svg";
}

function isLikelyTrackpadWheel(event: { deltaMode: number; deltaX: number; deltaY: number }): boolean {
  if (event.deltaMode !== 0) return false;
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  if (absX > 0 && absY > 0) return true;
  return absX < 40 && absY < 40;
}

function normalizeWheelDelta(deltaY: number, deltaMode: number, shellHeight: number): number {
  if (deltaMode === 1) {
    return deltaY * 16;
  }
  if (deltaMode === 2) {
    return deltaY * shellHeight;
  }
  return deltaY;
}

function isRpcKind(kind: string): boolean {
  return kind.startsWith("rpc.");
}

function isMessageKind(kind: string): boolean {
  return kind.startsWith("message.");
}

function isToolKind(kind: string): boolean {
  return kind.startsWith("tool.");
}

function isBusinessNodeKind(kind: string): boolean {
  return kind === "client" || kind === "agent" || kind === "session" || kind === "tool";
}

function shouldAnimateEventKind(kind: string): boolean {
  if (kind === "message.in" || kind === "message.out") return true;
  if (kind.startsWith("message.chat.")) return true;
  if (kind.startsWith("tool.")) return true;
  return false;
}

function shouldIncludeEvent(evt: GatewayTraceEvent, filters: RoutingFilters): boolean {
  if (isRpcKind(evt.kind)) return filters.rpc;
  if (isMessageKind(evt.kind)) return filters.messages;
  if (isToolKind(evt.kind)) return filters.tools;
  return true;
}

function resolveNodeGroup(kind: string): string {
  if (kind === "client") return "client";
  if (kind === "gateway") return "gateway";
  if (kind === "rpc") return "rpc";
  if (kind === "agent") return "agent";
  if (kind === "session") return "session";
  if (kind === "channel") return "channel";
  if (kind === "tool") return "tool";
  if (kind === "node") return "node";
  return "other";
}

function layoutNodes(nodes: Array<Omit<GraphNode, "x" | "y">>): Map<string, { x: number; y: number }> {
  const groups = new Map<string, Array<Omit<GraphNode, "x" | "y">>>();
  for (const node of nodes) {
    const group = resolveNodeGroup(node.kind);
    const existing = groups.get(group) ?? [];
    existing.push(node);
    groups.set(group, existing);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [group, listRaw] of groups.entries()) {
    const list = [...listRaw].sort((a, b) => a.label.localeCompare(b.label));
    const x = GRAPH_X_BY_GROUP[group] ?? GRAPH_W / 2;
    const range = GRAPH_Y_RANGES_BY_GROUP[group] ?? { top: GRAPH_PAD, bottom: GRAPH_H - GRAPH_PAD };
    const top = range.top;
    const bottom = Math.max(range.bottom, top);
    for (let i = 0; i < list.length; i += 1) {
      const t = list.length === 1 ? 0.5 : i / (list.length - 1);
      const y = top + t * (bottom - top);
      positions.set(list[i].key, { x, y });
    }
  }
  return positions;
}

function buildGraph(events: GatewayTraceEvent[], now: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, Omit<GraphNode, "x" | "y">>();
  const edges = new Map<string, GraphEdge>();

  for (const evt of events) {
    if (!isBusinessNodeKind(safeString(evt.from.kind)) || !isBusinessNodeKind(safeString(evt.to.kind))) {
      continue;
    }
    const kind = safeString(evt.kind).trim() || "event";
    const ts = typeof evt.ts === "number" && Number.isFinite(evt.ts) ? evt.ts : now;
    const shouldAnimate = shouldAnimateEventKind(kind);
    const fromKey = nodeKey(evt.from);
    const toKey = nodeKey(evt.to);

    const upsertNode = (node: GatewayTraceNode, key: string): void => {
      const existing = nodes.get(key);
      if (!existing) {
        nodes.set(key, {
          key,
          kind: String(node.kind),
          id: node.id,
          label: normalizeNodeLabel(node),
          lastTs: ts,
          lastAnimatedTs: shouldAnimate ? ts : null,
          activity: 1,
        });
        return;
      }
      existing.activity += 1;
      if (ts > existing.lastTs) existing.lastTs = ts;
      if (shouldAnimate && (existing.lastAnimatedTs === null || ts > existing.lastAnimatedTs)) {
        existing.lastAnimatedTs = ts;
      }
    };

    upsertNode(evt.from, fromKey);
    upsertNode(evt.to, toKey);

    const edgeKey = `${fromKey}->${toKey}:${kind}`;
    const edgeLabel = typeof evt.label === "string" && evt.label.trim() ? evt.label.trim() : null;
    const existingEdge = edges.get(edgeKey);

    if (!existingEdge) {
      edges.set(edgeKey, {
        key: edgeKey,
        kind,
        label: edgeLabel,
        fromKey,
        toKey,
        count: 1,
        lastTs: ts,
        lastAnimatedTs: shouldAnimate ? ts : null,
      });
    } else {
      existingEdge.count += 1;
      if (ts > existingEdge.lastTs) existingEdge.lastTs = ts;
      if (shouldAnimate && (existingEdge.lastAnimatedTs === null || ts > existingEdge.lastAnimatedTs)) {
        existingEdge.lastAnimatedTs = ts;
      }
      if (!existingEdge.label && edgeLabel) {
        existingEdge.label = edgeLabel;
      }
    }
  }

  const edgeList = [...edges.values()].sort((a, b) => b.lastTs - a.lastTs).slice(0, EDGE_LIMIT);
  const connectedNodeKeys = new Set<string>();
  for (const edge of edgeList) {
    connectedNodeKeys.add(edge.fromKey);
    connectedNodeKeys.add(edge.toKey);
  }

  const nodeList = [...nodes.values()].filter((item) => connectedNodeKeys.has(item.key)).sort((a, b) => b.lastTs - a.lastTs);
  const layout = layoutNodes(nodeList);

  const laidOutNodes: GraphNode[] = nodeList.map((node) => ({
    ...node,
    x: layout.get(node.key)?.x ?? GRAPH_W / 2,
    y: layout.get(node.key)?.y ?? GRAPH_H / 2,
  }));

  const nodeByKey = new Map(laidOutNodes.map((node) => [node.key, node]));
  const laidOutEdges = edgeList.filter((edge) => nodeByKey.has(edge.fromKey) && nodeByKey.has(edge.toKey));
  return { nodes: laidOutNodes, edges: laidOutEdges };
}

function fillForNodeKind(kind: string): string {
  if (kind === "client") return "#fef3c7";
  if (kind === "gateway") return "#dbeafe";
  if (kind === "rpc") return "#dbeafe";
  if (kind === "agent") return "#dcfce7";
  if (kind === "tool") return "#ffedd5";
  if (kind === "session") return "#e0e7ff";
  if (kind === "channel") return "#ccfbf1";
  if (kind === "node") return "#f3e8ff";
  return "#e5e7eb";
}

function strokeForNodeKind(kind: string): string {
  if (kind === "client") return "#f59e0b";
  if (kind === "gateway") return "#2563eb";
  if (kind === "rpc") return "#2563eb";
  if (kind === "agent") return "#16a34a";
  if (kind === "tool") return "#ea580c";
  if (kind === "session") return "#4f46e5";
  if (kind === "channel") return "#0d9488";
  if (kind === "node") return "#7c3aed";
  return "#64748b";
}

function graphLabelLimitByKind(kind: string): number {
  if (kind === "gateway") return 20;
  if (kind === "session") return 10;
  if (kind === "channel") return 14;
  return 16;
}

function truncateLabel(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

function formatDetailValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") return value.trim() || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safeString(value);
}

function buildNodeSessionAction(data: {
  type: TopologyLane;
  instanceId?: string;
  agentId?: string;
  sessionKey?: string;
}): TopologyNodeAction {
  if (data.type === "instance") {
    return {
      kind: "disabled",
      statusLabel: "已禁用",
      detail: "实例节点不提供会话入口",
    };
  }

  if (data.type === "agent") {
    if (data.instanceId && data.agentId) {
      return {
        kind: "enter",
        statusLabel: "可进入",
        detail: "默认会话",
        actionLabel: "进入默认会话",
        href: buildSessionEntryPath({
          instanceId: data.instanceId,
          agentId: data.agentId,
        }),
      };
    }

    return {
      kind: "disabled",
      statusLabel: "已禁用",
      detail: "缺少进入上下文",
    };
  }

  if (data.type === "session") {
    if (data.instanceId && data.agentId && data.sessionKey) {
      return {
        kind: "enter",
        statusLabel: "可进入",
        detail: "精确会话",
        actionLabel: "进入对应会话",
        href: buildSessionEntryPath({
          instanceId: data.instanceId,
          agentId: data.agentId,
          preferredSessionKey: data.sessionKey,
        }),
      };
    }

    return {
      kind: "disabled",
      statusLabel: "已禁用",
      detail: "缺少 session key",
    };
  }

  if (data.instanceId && data.agentId) {
    return {
      kind: "fallback",
      statusLabel: "回退入口",
      detail: "回退到所属智能体",
      actionLabel: "回退到所属智能体",
      href: buildSessionEntryPath({
        instanceId: data.instanceId,
        agentId: data.agentId,
        preferredSessionKey: data.sessionKey,
      }),
    };
  }

  return {
    kind: "disabled",
    statusLabel: "已禁用",
    detail: "缺少可回退上下文",
  };
}

function topologyToTraceEvents(topology: AggregateTopologyResponse, now: number): GatewayTraceEvent[] {
  const events: GatewayTraceEvent[] = [];
  const snapshotFloor = now - 60_000;
  const normalizeSnapshotTs = (value: string | null | undefined): number => {
    return Math.max(parseIsoTimestamp(value, now), snapshotFloor);
  };

  const instanceByNode = new Map(topology.instances.map((item) => [item.node_id, item]));
  const agentByNode = new Map(topology.agents.map((item) => [item.node_id, item]));
  const sessionByNode = new Map(topology.sessions.map((item) => [item.node_id, item]));
  const toolByNode = new Map(topology.tools.map((item) => [item.node_id, item]));

  for (const instance of topology.instances) {
    const ts = normalizeSnapshotTs(instance.last_check_at);
    const instanceRef = stableNodeRef(instance.node_id, instance.instance_id);
    events.push({
      id: `rpc-health:${instance.instance_id}:${ts}`,
      ts,
      kind: "rpc.health",
      from: { kind: "client", id: instanceRef, label: instance.name },
      to: { kind: "gateway", id: "gateway", label: "gateway" },
      label: instance.status,
      data: {
        source: "aggregate.topology",
        instanceId: instance.instance_id,
        status: instance.status,
      },
    });
  }

  for (const edge of topology.edges) {
    if (edge.kind === "instance_agent") {
      const instance = instanceByNode.get(edge.source);
      const agent = agentByNode.get(edge.target);
      const ts = normalizeSnapshotTs(agent?.last_active_at ?? instance?.last_check_at ?? null);
      if (!instance || !agent) continue;
      const instanceRef = stableNodeRef(instance.node_id, instance.instance_id);
      const agentRef = stableNodeRef(agent.node_id, agent.agent_id);
      events.push({
        id: `edge:${edge.kind}:${edge.source}:${edge.target}:${ts}`,
        ts,
        kind: "message.in",
        from: { kind: "client", id: instanceRef, label: instance.name },
        to: { kind: "agent", id: agentRef, label: agent.agent_name },
        label: agent.status,
        runId: agent.agent_id,
        data: { edgeKind: edge.kind },
      });
      continue;
    }

    if (edge.kind === "agent_session") {
      const agent = agentByNode.get(edge.source);
      const session = sessionByNode.get(edge.target);
      const ts = normalizeSnapshotTs(session?.updated_at ?? agent?.last_active_at ?? null);
      if (!agent || !session) continue;
      const agentRef = stableNodeRef(agent.node_id, agent.agent_id);
      const sessionRef = stableNodeRef(session.node_id, session.session_key);
      events.push({
        id: `edge:${edge.kind}:${edge.source}:${edge.target}:${ts}`,
        ts,
        kind: "message.out",
        from: { kind: "agent", id: agentRef, label: agent.agent_name },
        to: { kind: "session", id: sessionRef, label: session.label },
        label: session.label,
        sessionKey: session.session_key,
        runId: agent.agent_id,
        data: { edgeKind: edge.kind },
      });
      continue;
    }

    if (edge.kind === "agent_tool") {
      const agent = agentByNode.get(edge.source);
      const tool = toolByNode.get(edge.target);
      const ts = normalizeSnapshotTs(agent?.last_active_at ?? null);
      if (!agent || !tool) continue;
      const agentRef = stableNodeRef(agent.node_id, agent.agent_id);
      const toolRef = stableNodeRef(tool.node_id, tool.tool_id || tool.name);
      events.push({
        id: `edge:${edge.kind}:${edge.source}:${edge.target}:${ts}`,
        ts,
        kind: "tool.invoke",
        from: { kind: "agent", id: agentRef, label: agent.agent_name },
        to: { kind: "tool", id: toolRef, label: tool.name },
        label: tool.name,
        runId: agent.agent_id,
        data: { edgeKind: edge.kind },
      });
    }
  }

  if (topology.partial_failure) {
    for (const diagnostic of topology.diagnostics) {
      if (diagnostic.status !== "failed" || !diagnostic.error) continue;
      const ts = normalizeSnapshotTs(diagnostic.freshness.checked_at);
      events.push({
        id: `diag:${diagnostic.instance_id}:${diagnostic.error.code}:${ts}`,
        ts,
        kind: "rpc.error",
        from: {
          kind: "gateway",
          id: "gateway",
          label: "gateway",
        },
        to: {
          kind: "rpc",
          id: diagnostic.error.code,
          label: diagnostic.error.code,
        },
        label: diagnostic.error.message,
        data: {
          source: "diagnostic",
          instanceId: diagnostic.instance_id,
          requestId: diagnostic.error.request_id,
          recoverable: diagnostic.error.recoverable,
        },
      });
    }
  }

  return events;
}

function mapNodeEventKind(eventType: string): string {
  if (eventType.includes("interrupted") || eventType.includes("error")) return "node.error";
  if (eventType.includes("finished")) return "node.finished";
  if (eventType.includes("started")) return "node.started";
  return "node.update";
}

function nodeEventsToTraceEvents(agentId: string, nodeId: string, events: EventRecord[], now: number): GatewayTraceEvent[] {
  return events.map((item) => {
    const ts = parseIsoTimestamp(item.timestamp, now);
    return {
      id: `rt:${agentId}:${nodeId}:${item.id}:${ts}`,
      ts,
      kind: mapNodeEventKind(item.type),
      from: { kind: "agent", id: agentId, label: agentId },
      to: { kind: "node", id: nodeId, label: nodeId },
      label: item.description,
      runId: agentId,
      data: {
        source: "observer.node_events",
        eventType: item.type,
        nodeId,
      },
    };
  });
}

function computeSceneBounds(nodes: GraphNode[]): GraphSceneBounds {
  if (nodes.length === 0) {
    return {
      minX: -GRAPH_W * 0.2,
      maxX: GRAPH_W * 1.2,
      minY: -GRAPH_H * 0.2,
      maxY: GRAPH_H * 1.2,
    };
  }
  return {
    minX: Math.min(...nodes.map((item) => item.x)) - 220,
    maxX: Math.max(...nodes.map((item) => item.x)) + 220,
    minY: Math.min(...nodes.map((item) => item.y)) - 180,
    maxY: Math.max(...nodes.map((item) => item.y)) + 240,
  };
}

function clampCameraToScene(camera: GraphCamera, scene: GraphSceneBounds, viewportWidth: number, viewportHeight: number): GraphCamera {
  const safeViewportWidth = Math.max(1, viewportWidth);
  const safeViewportHeight = Math.max(1, viewportHeight);
  const scale = clamp(camera.scale, MIN_GRAPH_SCALE, MAX_GRAPH_SCALE);
  const viewportWorldWidth = safeViewportWidth / scale;
  const viewportWorldHeight = safeViewportHeight / scale;
  const sceneWidth = Math.max(1, scene.maxX - scene.minX);
  const sceneHeight = Math.max(1, scene.maxY - scene.minY);
  const marginX = Math.max(220, sceneWidth * 0.08);
  const marginY = Math.max(160, sceneHeight * 0.08);

  let worldLeft = -camera.offsetX;
  let worldTop = -camera.offsetY;

  if (sceneWidth <= viewportWorldWidth) {
    worldLeft = scene.minX + sceneWidth * 0.5 - viewportWorldWidth * 0.5;
  } else {
    worldLeft = clamp(worldLeft, scene.minX - marginX, scene.maxX + marginX - viewportWorldWidth);
  }

  if (sceneHeight <= viewportWorldHeight) {
    worldTop = scene.minY + sceneHeight * 0.5 - viewportWorldHeight * 0.5;
  } else {
    worldTop = clamp(worldTop, scene.minY - marginY, scene.maxY + marginY - viewportWorldHeight);
  }

  const nextOffsetX = -worldLeft;
  const nextOffsetY = -worldTop;
  if (
    Math.abs(scale - camera.scale) < 0.0001
    && Math.abs(nextOffsetX - camera.offsetX) < 0.001
    && Math.abs(nextOffsetY - camera.offsetY) < 0.001
  ) {
    return camera;
  }
  return {
    scale,
    offsetX: nextOffsetX,
    offsetY: nextOffsetY,
  };
}

function buildFitCamera(nodes: GraphNode[], viewportWidth: number, viewportHeight: number): GraphCamera {
  if (nodes.length === 0) {
    return DEFAULT_GRAPH_CAMERA;
  }
  const safeViewportWidth = Math.max(1, viewportWidth);
  const safeViewportHeight = Math.max(1, viewportHeight);
  const minX = Math.min(...nodes.map((item) => item.x)) - 160;
  const maxX = Math.max(...nodes.map((item) => item.x)) + 160;
  const minY = Math.min(...nodes.map((item) => item.y)) - 140;
  const maxY = Math.max(...nodes.map((item) => item.y)) + 220;
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const fitScale = Math.min(safeViewportWidth / contentWidth, safeViewportHeight / contentHeight) * 0.94;
  const scale = clamp(fitScale, MIN_GRAPH_SCALE, MAX_GRAPH_SCALE);
  const viewportWorldWidth = safeViewportWidth / scale;
  const viewportWorldHeight = safeViewportHeight / scale;
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  return {
    scale,
    offsetX: -centerX + viewportWorldWidth * 0.5,
    offsetY: -centerY + viewportWorldHeight * 0.5,
  };
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

function TopologyCanvas(): JSX.Element {
  const isMobile = useIsMobile();
  const graphShellRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const agentsListRealtimeRef = useRef<ReturnType<typeof createObserverRealtimeClient> | null>(null);
  const agentRealtimeRefs = useRef<Map<string, ReturnType<typeof createObserverRealtimeClient>>>(new Map());
  const realtimeRefreshAtRef = useRef(0);
  const draggingRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originOffsetX: number;
    originOffsetY: number;
    originScale: number;
  } | null>(null);
  const nodeDraggingRef = useRef<{
    pointerId: number;
    nodeKey: string;
    startClientX: number;
    startClientY: number;
    baseX: number;
    baseY: number;
    originOffsetX: number;
    originOffsetY: number;
    moved: boolean;
  } | null>(null);
  const suppressNodeClickRef = useRef(false);
  const hasManualViewportRef = useRef(false);
  const hasAutoFittedRef = useRef(false);

  const [topology, setTopology] = useState<AggregateTopologyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [paused, setPaused] = useState(false);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
  const [realtimeMessage, setRealtimeMessage] = useState<string | null>(null);
  const [windowMinutes, setWindowMinutes] = useState(10);
  const [filters, setFilters] = useState<RoutingFilters>({ rpc: true, messages: true, tools: true });
  const [topologyEvents, setTopologyEvents] = useState<GatewayTraceEvent[]>([]);
  const [realtimeNodeEvents, setRealtimeNodeEvents] = useState<GatewayTraceEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [camera, setCamera] = useState<GraphCamera>(DEFAULT_GRAPH_CAMERA);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [nodeOffsetByKey, setNodeOffsetByKey] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);

  const appendTopologyEvents = useCallback((payload: AggregateTopologyResponse): void => {
    const tsNow = Date.now();
    const trace = topologyToTraceEvents(payload, tsNow);
    setNow(tsNow);
    setTopologyEvents(trace);
    setRealtimeNodeEvents([]);
  }, []);

  const appendRealtimeNodeEvents = useCallback((agentId: string, nodeId: string, events: EventRecord[]): void => {
    if (!events.length) return;
    const tsNow = Date.now();
    const trace = nodeEventsToTraceEvents(agentId, nodeId, events, tsNow);
    setNow(tsNow);
    setRealtimeNodeEvents(trace);
  }, []);

  const loadTopology = useCallback(
    async (mode: "initial" | "manual" | "poll" = "manual"): Promise<void> => {
      const keepScene = mode === "poll";
      try {
        if (!keepScene) {
          setLoading(true);
        }
        const data = await getAggregateTopology();
        setTopology(data);
        setError(null);
        appendTopologyEvents(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("获取聚合拓扑失败"));
      } finally {
        if (!keepScene) {
          setLoading(false);
        }
      }
    },
    [appendTopologyEvents],
  );

  const refreshTopologyFromRealtime = useCallback(() => {
    if (paused) return;
    const tsNow = Date.now();
    if (tsNow - realtimeRefreshAtRef.current < REALTIME_REFRESH_THROTTLE_MS) {
      return;
    }
    realtimeRefreshAtRef.current = tsNow;
    void loadTopology("poll");
  }, [loadTopology, paused]);

  const closeRealtimeConnections = useCallback(() => {
    agentsListRealtimeRef.current?.close();
    agentsListRealtimeRef.current = null;
    for (const client of agentRealtimeRefs.current.values()) {
      client.close();
    }
    agentRealtimeRefs.current.clear();
  }, []);

  useEffect(() => {
    void loadTopology("initial");
  }, [loadTopology]);

  useEffect(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (paused) return;

    pollTimerRef.current = window.setInterval(() => {
      void loadTopology("poll");
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [paused, loadTopology]);

  const topologyAgentIds = useMemo(
    () => [...new Set((topology?.agents ?? []).map((item) => item.agent_id).filter(Boolean))],
    [topology?.agents],
  );

  useEffect(() => {
    if (paused) {
      setRealtimeState("paused");
      setRealtimeMessage("实时采集已暂停");
      agentsListRealtimeRef.current?.close();
      agentsListRealtimeRef.current = null;
      return;
    }

    setRealtimeState("connecting");
    setRealtimeMessage(null);
    const client = createObserverRealtimeClient({
      dataSource: getDefaultObserverDataSource(),
      channel: "agents:list",
      onMessage: (message) => {
        if (paused) return;
        if (message.type === "snapshot_ready") {
          setRealtimeState("realtime");
          setRealtimeMessage(null);
          return;
        }
        if (message.type === "agent_summary_updated") {
          setRealtimeState("realtime");
          refreshTopologyFromRealtime();
          return;
        }
        if (message.type === "resync_required") {
          setRealtimeState("connecting");
          setRealtimeMessage(`需要重同步：${message.payload.reason}`);
          refreshTopologyFromRealtime();
          return;
        }
        if (message.type === "error") {
          setRealtimeState("error");
          setRealtimeMessage(message.payload.detail);
        }
      },
      onParseError: (_raw, err) => {
        setRealtimeState("error");
        setRealtimeMessage(err.message);
      },
      onDisconnected: () => {
        setRealtimeState("disconnected");
        setRealtimeMessage("observer 连接已断开，等待下一次刷新");
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
  }, [paused, refreshTopologyFromRealtime]);

  useEffect(() => {
    if (paused) {
      for (const client of agentRealtimeRefs.current.values()) {
        client.close();
      }
      agentRealtimeRefs.current.clear();
      return;
    }

    const activeSet = new Set(topologyAgentIds);
    for (const [agentId, client] of agentRealtimeRefs.current.entries()) {
      if (!activeSet.has(agentId)) {
        client.close();
        agentRealtimeRefs.current.delete(agentId);
      }
    }

    for (const agentId of topologyAgentIds) {
      if (agentRealtimeRefs.current.has(agentId)) {
        continue;
      }
      const detailClient = createObserverRealtimeClient({
        dataSource: getDefaultObserverDataSource(),
        channel: buildAgentDetailChannel(agentId),
        onMessage: (message) => {
          if (paused) return;
          if (message.type === "snapshot_ready") {
            setRealtimeState("realtime");
            setRealtimeMessage(null);
            return;
          }
          if (message.type === "topology_updated") {
            setRealtimeState("realtime");
            setRealtimeMessage(null);
            refreshTopologyFromRealtime();
            return;
          }
          if (message.type === "node_events_appended") {
            setRealtimeState("realtime");
            appendRealtimeNodeEvents(message.payload.agent_id, message.payload.node_id, message.payload.events);
            refreshTopologyFromRealtime();
            return;
          }
          if (message.type === "resync_required") {
            setRealtimeState("connecting");
            setRealtimeMessage(`智能体 ${agentId} 需要重同步`);
            refreshTopologyFromRealtime();
            return;
          }
          if (message.type === "error") {
            setRealtimeState("error");
            setRealtimeMessage(message.payload.detail);
          }
        },
        onParseError: (_raw, err) => {
          setRealtimeState("error");
          setRealtimeMessage(err.message);
        },
        onDisconnected: () => {
          setRealtimeState("disconnected");
          setRealtimeMessage(`智能体 ${agentId} realtime 连接已断开`);
        },
      });
      detailClient.connect();
      agentRealtimeRefs.current.set(agentId, detailClient);
    }
  }, [appendRealtimeNodeEvents, paused, refreshTopologyFromRealtime, topologyAgentIds]);

  useEffect(() => {
    return () => {
      closeRealtimeConnections();
    };
  }, [closeRealtimeConnections]);

  const envelope = error instanceof ApiError ? error.envelope : null;
  const unauthorized = envelope?.code === "unauthorized";

  const filteredEvents = useMemo(() => {
    const allEvents = [...realtimeNodeEvents, ...topologyEvents];
    const cutoff = now - windowMinutes * 60_000;
    return allEvents
      .filter((event) => event.ts >= cutoff)
      .filter((event) => shouldIncludeEvent(event, filters));
  }, [filters, now, realtimeNodeEvents, topologyEvents, windowMinutes]);

  const graphData = useMemo(() => buildGraph(filteredEvents, now), [filteredEvents, now]);

  const businessNodeActions = useMemo(() => {
    const map = new Map<string, { testId: string; action: TopologyNodeAction; linkTestId?: string }>();
    if (!topology) return map;

    for (const instance of topology.instances) {
      const instanceId = instance.instance_id ?? "";
      const instanceRef = stableNodeRef(instance.node_id, instance.instance_id);
      map.set(`client:${instanceRef}`, {
        testId: `topology-node-instance-${instanceId}`,
        action: buildNodeSessionAction({
          type: "instance",
          instanceId,
        }),
      });
    }

    for (const agent of topology.agents) {
      const agentId = agent.agent_id ?? "";
      const agentRef = stableNodeRef(agent.node_id, agent.agent_id);
      map.set(`agent:${agentRef}`, {
        testId: `topology-node-agent-${agentId}`,
        action: buildNodeSessionAction({
          type: "agent",
          instanceId: agent.instance_id,
          agentId,
        }),
        linkTestId: `drilldown-link-${agentId}`,
      });
    }

    for (const session of topology.sessions) {
      const sessionKey = session.session_key ?? "";
      const sessionRef = stableNodeRef(session.node_id, session.session_key);
      map.set(`session:${sessionRef}`, {
        testId: `topology-node-session-${sessionKey}`,
        action: buildNodeSessionAction({
          type: "session",
          instanceId: session.instance_id,
          agentId: session.agent_id,
          sessionKey,
        }),
      });
    }

    for (const tool of topology.tools) {
      const toolRef = stableNodeRef(tool.node_id, tool.tool_id || tool.name);
      const toolName = tool.name ?? "";
      const meta = {
        testId: `topology-node-tool-${toolName}`,
        action: buildNodeSessionAction({
          type: "tool",
          instanceId: tool.instance_id,
          agentId: tool.agent_id || undefined,
        }),
      };
      map.set(`tool:${toolRef}`, meta);
    }

    return map;
  }, [topology]);

  const instanceById = useMemo(() => {
    return new Map((topology?.instances ?? []).map((item) => [item.instance_id, item]));
  }, [topology?.instances]);
  const instanceByNodeId = useMemo(() => {
    return new Map((topology?.instances ?? []).map((item) => [item.node_id, item]));
  }, [topology?.instances]);

  const agentById = useMemo(() => {
    return new Map((topology?.agents ?? []).map((item) => [item.agent_id, item]));
  }, [topology?.agents]);
  const agentByNodeId = useMemo(() => {
    return new Map((topology?.agents ?? []).map((item) => [item.node_id, item]));
  }, [topology?.agents]);

  const sessionByKey = useMemo(() => {
    return new Map((topology?.sessions ?? []).map((item) => [item.session_key, item]));
  }, [topology?.sessions]);
  const sessionByNodeId = useMemo(() => {
    return new Map((topology?.sessions ?? []).map((item) => [item.node_id, item]));
  }, [topology?.sessions]);

  const toolById = useMemo(() => {
    const map = new Map<string, AggregateTopologyToolItem>();
    for (const item of topology?.tools ?? []) {
      if (item.tool_id) {
        map.set(item.tool_id, item);
      }
      if (item.name && item.name !== item.tool_id) {
        map.set(item.name, item);
      }
    }
    return map;
  }, [topology?.tools]);
  const toolByNodeId = useMemo(() => {
    return new Map((topology?.tools ?? []).map((item) => [item.node_id, item]));
  }, [topology?.tools]);

  const displayNodes = useMemo<GraphNode[]>(() => {
    if (!topology) return graphData.nodes;

    const nodes = new Map<string, Omit<GraphNode, "x" | "y">>();
    for (const node of graphData.nodes) {
      nodes.set(node.key, {
        key: node.key,
        kind: node.kind,
        id: node.id,
        label: node.label,
        lastTs: node.lastTs,
        lastAnimatedTs: node.lastAnimatedTs,
        activity: node.activity,
      });
    }

    const ensureNode = (key: string, kind: string, id: string, label: string): void => {
      if (nodes.has(key)) return;
      nodes.set(key, {
        key,
        kind,
        id,
        label,
        lastTs: now,
        lastAnimatedTs: null,
        activity: 0,
      });
    };

    for (const instance of topology.instances) {
      const instanceRef = stableNodeRef(instance.node_id, instance.instance_id);
      ensureNode(`client:${instanceRef}`, "client", instanceRef, instance.name || instance.instance_id || "instance");
    }

    for (const agent of topology.agents) {
      const agentRef = stableNodeRef(agent.node_id, agent.agent_id);
      ensureNode(`agent:${agentRef}`, "agent", agentRef, agent.agent_name || agent.agent_id || "agent");
    }

    for (const session of topology.sessions) {
      const sessionRef = stableNodeRef(session.node_id, session.session_key);
      ensureNode(`session:${sessionRef}`, "session", sessionRef, session.label || session.session_key || "session");
    }

    for (const tool of topology.tools) {
      const toolRef = stableNodeRef(tool.node_id, tool.tool_id || tool.name);
      ensureNode(`tool:${toolRef}`, "tool", toolRef, tool.name || tool.tool_id || "tool");
    }

    const nodeList = [...nodes.values()].sort((a, b) => b.lastTs - a.lastTs);
    const layout = layoutNodes(nodeList);

    return nodeList.map((node) => ({
      ...node,
      x: layout.get(node.key)?.x ?? GRAPH_W / 2,
      y: layout.get(node.key)?.y ?? GRAPH_H / 2,
    }));
  }, [graphData.nodes, now, topology]);

  const baseDisplayNodeByKey = useMemo(() => {
    return new Map(displayNodes.map((node) => [node.key, node]));
  }, [displayNodes]);

  const renderNodes = useMemo<GraphNode[]>(() => {
    return displayNodes.map((node) => ({
      ...node,
      x: node.x + (nodeOffsetByKey[node.key]?.x ?? 0),
      y: node.y + (nodeOffsetByKey[node.key]?.y ?? 0),
    }));
  }, [displayNodes, nodeOffsetByKey]);

  const renderNodeByKey = useMemo(() => {
    return new Map(renderNodes.map((node) => [node.key, node]));
  }, [renderNodes]);
  const sceneBounds = useMemo(() => computeSceneBounds(renderNodes), [renderNodes]);

  useEffect(() => {
    const keySet = new Set(displayNodes.map((node) => node.key));
    setNodeOffsetByKey((prev) => {
      const next: Record<string, { x: number; y: number }> = {};
      let changed = false;
      for (const [key, offset] of Object.entries(prev)) {
        if (keySet.has(key)) {
          next[key] = offset;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [displayNodes]);

  useEffect(() => {
    if (!selectedNodeKey) return;
    if (!renderNodeByKey.has(selectedNodeKey)) {
      setSelectedNodeKey(null);
    }
  }, [renderNodeByKey, selectedNodeKey]);

  const handleRefresh = useCallback(() => {
    void loadTopology("manual");
  }, [loadTopology]);

  const fitCamera = useCallback(() => {
    const shell = graphShellRef.current;
    const viewportWidth = shell?.clientWidth || GRAPH_W;
    const viewportHeight = shell?.clientHeight || GRAPH_H;
    const fitted = buildFitCamera(renderNodes, viewportWidth, viewportHeight);
    setCamera(clampCameraToScene(fitted, sceneBounds, viewportWidth, viewportHeight));
  }, [renderNodes, sceneBounds]);

  const handleFit = useCallback(() => {
    hasManualViewportRef.current = false;
    hasAutoFittedRef.current = true;
    fitCamera();
  }, [fitCamera]);

  useEffect(() => {
    if (loading || error) return;
    if (hasManualViewportRef.current) return;
    if (renderNodes.length === 0) {
      hasAutoFittedRef.current = false;
      return;
    }
    if (hasAutoFittedRef.current) return;
    hasAutoFittedRef.current = true;
    fitCamera();
  }, [error, fitCamera, loading, renderNodes.length]);

  useEffect(() => {
    const shell = graphShellRef.current;
    const viewportWidth = shell?.clientWidth || GRAPH_W;
    const viewportHeight = shell?.clientHeight || GRAPH_H;
    setCamera((prev) => clampCameraToScene(prev, sceneBounds, viewportWidth, viewportHeight));
  }, [sceneBounds]);

  const handleCanvasWheel = useCallback((event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const shell = graphShellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    hasManualViewportRef.current = true;
    const pointerCanvasX = event.clientX - rect.left;
    const pointerCanvasY = event.clientY - rect.top;
    const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode, rect.height);
    const trackpad = isLikelyTrackpadWheel(event);

    setCamera((prev) => {
      const prevScale = prev.scale;
      let nextScale = prevScale;

      if (trackpad) {
        nextScale = prevScale * (1 + deltaY * (1 - WHEEL_ZOOM_SPEED) * 0.18);
      } else if (deltaY < 0) {
        nextScale = prevScale * WHEEL_ZOOM_SPEED;
      } else if (deltaY > 0) {
        nextScale = prevScale / WHEEL_ZOOM_SPEED;
      }

      nextScale = clamp(nextScale, MIN_GRAPH_SCALE, MAX_GRAPH_SCALE);
      if (Math.abs(nextScale - prevScale) < 0.00001) return prev;

      const worldX = pointerCanvasX / prevScale - prev.offsetX;
      const worldY = pointerCanvasY / prevScale - prev.offsetY;
      const nextOffsetX = pointerCanvasX / nextScale - worldX;
      const nextOffsetY = pointerCanvasY / nextScale - worldY;
      return clampCameraToScene(
        { scale: nextScale, offsetX: nextOffsetX, offsetY: nextOffsetY },
        sceneBounds,
        rect.width,
        rect.height,
      );
    });
  }, [sceneBounds]);

  const handleCanvasPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originOffsetX: camera.offsetX,
      originOffsetY: camera.offsetY,
      originScale: camera.scale,
    };
    hasManualViewportRef.current = true;
    setIsPanning(true);
  }, [camera.offsetX, camera.offsetY, camera.scale]);

  const handleCanvasPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = draggingRef.current;
    const shell = graphShellRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !shell) return;
    const rect = shell.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const scale = drag.originScale || 1;
    const deltaWorldX = (event.clientX - drag.startClientX) / scale;
    const deltaWorldY = (event.clientY - drag.startClientY) / scale;
    setCamera(clampCameraToScene({
      scale: drag.originScale,
      offsetX: drag.originOffsetX + deltaWorldX,
      offsetY: drag.originOffsetY + deltaWorldY,
    }, sceneBounds, rect.width, rect.height));
  }, [sceneBounds]);

  const handleCanvasPointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = draggingRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      draggingRef.current = null;
      setIsPanning(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const toggleFilter = useCallback((key: keyof RoutingFilters) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleNodePointerDown = useCallback(
    (nodeKey: string, event: ReactPointerEvent<SVGGElement>) => {
      if (event.button !== 0) return;
      const baseNode = baseDisplayNodeByKey.get(nodeKey);
      if (!baseNode) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      nodeDraggingRef.current = {
        pointerId: event.pointerId,
        nodeKey,
        startClientX: event.clientX,
        startClientY: event.clientY,
        baseX: baseNode.x,
        baseY: baseNode.y,
        originOffsetX: nodeOffsetByKey[nodeKey]?.x ?? 0,
        originOffsetY: nodeOffsetByKey[nodeKey]?.y ?? 0,
        moved: false,
      };
      suppressNodeClickRef.current = false;
    },
    [baseDisplayNodeByKey, nodeOffsetByKey],
  );

  const handleNodePointerMove = useCallback(
    (event: ReactPointerEvent<SVGGElement>) => {
      const drag = nodeDraggingRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const shell = graphShellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      event.preventDefault();
      event.stopPropagation();

      const baseNode = baseDisplayNodeByKey.get(drag.nodeKey);
      if (!baseNode) return;
      const scale = Math.max(0.0001, camera.scale);
      const deltaX = (event.clientX - drag.startClientX) / scale;
      const deltaY = (event.clientY - drag.startClientY) / scale;
      if (
        Math.abs(event.clientX - drag.startClientX) >= 2
        || Math.abs(event.clientY - drag.startClientY) >= 2
      ) {
        drag.moved = true;
      }
      const currentX = drag.baseX + drag.originOffsetX + deltaX;
      const currentY = drag.baseY + drag.originOffsetY + deltaY;
      const clampedX = clamp(currentX, sceneBounds.minX - NODE_DRAG_EXTRA_X, sceneBounds.maxX + NODE_DRAG_EXTRA_X);
      const clampedY = clamp(currentY, sceneBounds.minY - NODE_DRAG_EXTRA_Y, sceneBounds.maxY + NODE_DRAG_EXTRA_Y);
      const nextOffsetX = clampedX - drag.baseX;
      const nextOffsetY = clampedY - drag.baseY;
      setNodeOffsetByKey((prev) => {
        const current = prev[drag.nodeKey] ?? { x: 0, y: 0 };
        if (
          Math.abs(current.x - nextOffsetX) < 0.001
          && Math.abs(current.y - nextOffsetY) < 0.001
        ) {
          return prev;
        }
        return { ...prev, [drag.nodeKey]: { x: nextOffsetX, y: nextOffsetY } };
      });
    },
    [baseDisplayNodeByKey, camera.scale, sceneBounds.maxX, sceneBounds.maxY, sceneBounds.minX, sceneBounds.minY],
  );

  const handleNodePointerUp = useCallback((event: ReactPointerEvent<SVGGElement>) => {
    const drag = nodeDraggingRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    nodeDraggingRef.current = null;
    if (drag.moved) {
      suppressNodeClickRef.current = true;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleNodeClick = useCallback((nodeKey: string) => {
    if (suppressNodeClickRef.current) {
      suppressNodeClickRef.current = false;
      return;
    }
    setSelectedNodeKey(nodeKey);
  }, []);

  const handleLogEvents = useCallback(() => {
    const rows = filteredEvents.slice(0, 80).map((event) => ({
      id: event.id,
      kind: event.kind,
      ts: new Date(event.ts).toISOString(),
      from: formatNodeLabel(event.from),
      to: formatNodeLabel(event.to),
      sessionKey: event.sessionKey ?? "",
      runId: event.runId ?? "",
      label: event.label ?? "",
    }));
    console.groupCollapsed(`[Topology] 技术事件明细 ${rows.length}/${filteredEvents.length}`);
    if (rows.length > 0) {
      console.table(rows);
    } else {
      console.info("[Topology] 当前窗口内无事件");
    }
    console.groupEnd();
  }, [filteredEvents]);

  const visualLabelByNodeKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const [instanceNodeId, instance] of instanceByNodeId.entries()) {
      map.set(`client:${instanceNodeId}`, instance.name || "实例");
    }
    for (const [agentNodeId, agent] of agentByNodeId.entries()) {
      map.set(`agent:${agentNodeId}`, agent.agent_name || "智能体");
    }
    for (const [sessionNodeId] of sessionByNodeId.entries()) {
      map.set(`session:${sessionNodeId}`, "会话");
    }
    for (const [toolNodeId, tool] of toolByNodeId.entries()) {
      map.set(`tool:${toolNodeId}`, tool.name || "工具");
    }
    return map;
  }, [agentByNodeId, instanceByNodeId, sessionByNodeId, toolByNodeId]);
  const gatewayAddress = useMemo(() => inferGatewayAddress(), []);

  const selectedNodeDetail = useMemo<NodeDetailState | null>(() => {
    if (!selectedNodeKey) return null;
    const node = renderNodeByKey.get(selectedNodeKey);
    if (!node) return null;
    const actionMeta = businessNodeActions.get(node.key);
    const action = actionMeta?.action;
    const linkTestId = actionMeta?.linkTestId;

    if (node.kind === "client") {
      const item = instanceByNodeId.get(node.id) ?? instanceById.get(node.id);
      return {
        title: item?.name || node.label,
        subtitle: "实例节点",
        action,
        rows: [
          { label: "instance_id", value: formatDetailValue(item?.instance_id ?? node.id) },
          { label: "type", value: formatDetailValue(item?.type) },
          { label: "status", value: formatDetailValue(item?.status) },
          { label: "last_check_at", value: formatDetailValue(item?.last_check_at) },
          { label: "created_at", value: formatDetailValue(item?.created_at) },
        ],
      };
    }

    if (node.kind === "agent") {
      const item = agentByNodeId.get(node.id) ?? agentById.get(node.id);
      return {
        title: item?.agent_name || node.label,
        subtitle: "智能体节点",
        action,
        linkTestId,
        rows: [
          { label: "agent_id", value: formatDetailValue(item?.agent_id ?? node.id) },
          { label: "agent_name", value: formatDetailValue(item?.agent_name || node.label) },
          { label: "instance_id", value: formatDetailValue(item?.instance_id) },
          { label: "status", value: formatDetailValue(item?.status) },
          { label: "last_active_at", value: formatDetailValue(item?.last_active_at) },
        ],
      };
    }

    if (node.kind === "session") {
      const item = sessionByNodeId.get(node.id) ?? sessionByKey.get(node.id);
      return {
        title: item?.label || node.label,
        subtitle: "会话节点",
        action,
        rows: [
          { label: "session_key", value: formatDetailValue(item?.session_key ?? node.id) },
          { label: "instance_id", value: formatDetailValue(item?.instance_id) },
          { label: "agent_id", value: formatDetailValue(item?.agent_id) },
          { label: "updated_at", value: formatDetailValue(item?.updated_at) },
        ],
      };
    }

    if (node.kind === "tool") {
      const item = toolByNodeId.get(node.id) ?? toolById.get(node.id);
      return {
        title: item?.name || node.label,
        subtitle: "工具节点",
        action,
        rows: [
          { label: "tool_id", value: formatDetailValue(item?.tool_id ?? node.id) },
          { label: "name", value: formatDetailValue(item?.name || node.label) },
          { label: "instance_id", value: formatDetailValue(item?.instance_id) },
          { label: "agent_id", value: formatDetailValue(item?.agent_id) },
        ],
      };
    }

    return {
      title: node.label,
      subtitle: `${friendlyNodeKind(node.kind)}节点`,
      rows: [
        { label: "node_key", value: node.key },
        { label: "kind", value: node.kind },
        { label: "id", value: formatDetailValue(node.id) },
        { label: "activity", value: String(node.activity) },
        { label: "last_ts", value: formatAbsoluteTime(node.lastTs) },
      ],
    };
  }, [
    agentById,
    agentByNodeId,
    businessNodeActions,
    instanceById,
    instanceByNodeId,
    renderNodeByKey,
    selectedNodeKey,
    sessionByKey,
    sessionByNodeId,
    toolById,
    toolByNodeId,
  ]);

  useEffect(() => {
    if (!selectedNodeDetail) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setSelectedNodeKey(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedNodeDetail]);

  const realtimeStateLabel = useMemo(() => {
    if (realtimeState === "realtime") return "实时已连接";
    if (realtimeState === "connecting") return "实时连接中";
    if (realtimeState === "paused") return "实时已暂停";
    if (realtimeState === "disconnected") return "实时已断开";
    return "实时异常";
  }, [realtimeState]);
  const hasRenderableNodes = renderNodes.length > 0;
  const worldTransform = useMemo(
    () => `translate(${camera.offsetX * camera.scale} ${camera.offsetY * camera.scale}) scale(${camera.scale})`,
    [camera.offsetX, camera.offsetY, camera.scale],
  );

  return (
    <div style={getCanvasContainerStyle(isMobile)} data-testid="topology-graph-canvas">
      <div style={controlsFabRootStyle}>
        {controlsOpen ? (
          <div style={controlsPanelStyle} data-testid="topology-controls-panel">
            <div style={controlsGroupStyle}>
              <button type="button" style={controlButtonStyle} onClick={handleFit} aria-label="适配画布">
                适配
              </button>
              <button type="button" style={controlButtonStyle} onClick={handleRefresh} aria-label="刷新">
                刷新
              </button>
              <button
                type="button"
                style={controlButtonStyle}
                onClick={() => setPaused((prev) => !prev)}
                aria-label={paused ? "恢复采集" : "暂停采集"}
              >
                {paused ? "恢复采集" : "暂停采集"}
              </button>
              <button type="button" style={controlButtonStyle} onClick={handleLogEvents} aria-label="打印事件明细">
                打印事件明细
              </button>
            </div>
            <div style={controlsGroupStyle}>
              <label style={filterFieldStyle}>
                <span style={filterLabelStyle}>窗口</span>
                <select
                  aria-label="事件窗口"
                  value={windowMinutes}
                  onChange={(event) => setWindowMinutes(Number(event.target.value))}
                  style={filterSelectStyle}
                >
                  {WINDOW_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={filterSwitchStyle}>
                <input
                  type="checkbox"
                  checked={filters.rpc}
                  onChange={() => toggleFilter("rpc")}
                  aria-label="过滤 RPC"
                />
                RPC
              </label>
              <label style={filterSwitchStyle}>
                <input
                  type="checkbox"
                  checked={filters.messages}
                  onChange={() => toggleFilter("messages")}
                  aria-label="过滤 消息"
                />
                消息
              </label>
              <label style={filterSwitchStyle}>
                <input
                  type="checkbox"
                  checked={filters.tools}
                  onChange={() => toggleFilter("tools")}
                  aria-label="过滤 工具"
                />
                工具
              </label>
            </div>
            <div style={controlsStatusRowStyle}>
              <span style={realtimeStateStyle}>
                {realtimeStateLabel}
              </span>
              {realtimeMessage ? <span style={realtimeHintStyle}>{realtimeMessage}</span> : null}
              <span style={eventCountStyle}>事件 {filteredEvents.length}</span>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          style={fabToggleButtonStyle}
          aria-label={controlsOpen ? "收起拓扑配置" : "展开拓扑配置"}
          onClick={() => setControlsOpen((prev) => !prev)}
          data-testid="topology-controls-fab"
        >
          {controlsOpen ? "关闭" : "配置"}
        </button>
      </div>

      {loading ? (
        <div style={stateContainerStyle}>
          <div style={emptyPanelStyle}>
            <p style={stateTitleStyle}>加载拓扑数据...</p>
            <p style={stateDetailStyle}>正在通过 getAggregateTopology 同步当前路由关系。</p>
          </div>
        </div>
      ) : error ? (
        <div style={stateContainerStyle}>
          <div style={errorPanelStyle}>
            <h2 style={errorTitleStyle}>{unauthorized ? "当前无权查看拓扑" : "拓扑暂时不可用"}</h2>
            <p style={errorTextStyle}>错误: {error.message}</p>
            {envelope ? <EnvelopeErrorSummary envelope={envelope} /> : null}
            <button type="button" style={retryButtonStyle} onClick={handleRefresh}>
              重试
            </button>
          </div>
        </div>
      ) : (
        <div style={contentRootStyle}>
          <div ref={graphShellRef} style={graphShellStyle}>
            <svg
              style={getGraphSvgStyle(isPanning)}
              viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="Linpo Topology 实时链路图"
              onWheel={handleCanvasWheel}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerLeave={handleCanvasPointerUp}
              onDoubleClick={handleFit}
            >
              <g transform={worldTransform}>
                {graphData.edges.map((edge) => {
                  const from = renderNodeByKey.get(edge.fromKey);
                  const to = renderNodeByKey.get(edge.toKey);
                  if (!from || !to) return null;

                  return (
                    <g key={edge.key}>
                      <path
                        d={buildEdgeCurvePath(from, to)}
                        stroke="#94a3b8"
                        strokeWidth={1.8}
                        strokeOpacity={0.82}
                        strokeLinecap="round"
                        fill="none"
                      />
                    </g>
                  );
                })}

                {renderNodes.map((node) => {
                  const highlighted = node.lastAnimatedTs != null && now - node.lastAnimatedTs <= GRAPH_HIGHLIGHT_MS;
                  const radius = clamp(15 + Math.log2(node.activity + 1) * 4, 15, 26);
                  const actionMeta = businessNodeActions.get(node.key);
                  const visualLabel = visualLabelByNodeKey.get(node.key)
                    ?? (node.kind === "gateway"
                      ? gatewayAddress
                      : node.kind === "session"
                        ? "会话"
                        : friendlyNodeKind(node.kind));
                  const iconPath = iconPathForNodeKind(node.kind);
                  const iconSize = Math.max(radius * 1.08, 17);
                  return (
                    <g
                      key={node.key}
                      transform={`translate(${node.x}, ${node.y})`}
                      data-testid={actionMeta?.testId}
                      onPointerDown={(event) => handleNodePointerDown(node.key, event)}
                      onPointerMove={handleNodePointerMove}
                      onPointerUp={handleNodePointerUp}
                      onPointerCancel={handleNodePointerUp}
                      onClick={() => handleNodeClick(node.key)}
                      style={graphNodeGroupStyle}
                    >
                      {highlighted ? (
                        <circle r={radius + 8} fill={strokeForNodeKind(node.kind)} opacity={0.12}>
                          <animate
                            attributeName="r"
                            values={`${radius + 6};${radius + 10};${radius + 6}`}
                            dur="1.3s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            values="0.10;0.20;0.10"
                            dur="1.3s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      ) : null}
                      <circle
                        r={radius}
                        fill={fillForNodeKind(node.kind)}
                        stroke={strokeForNodeKind(node.kind)}
                        strokeWidth={highlighted ? 3.2 : 2.4}
                        opacity={highlighted ? 0.96 : 0.9}
                      />
                      <image
                        href={iconPath}
                        x={-iconSize / 2}
                        y={-iconSize / 2}
                        width={iconSize}
                        height={iconSize}
                        preserveAspectRatio="xMidYMid meet"
                        opacity={0.95}
                      />
                      <text style={graphNodeLabelStyle} textAnchor="middle" y={radius + 14}>
                        {truncateLabel(visualLabel, graphLabelLimitByKind(node.kind))}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            {!hasRenderableNodes ? (
              <div style={graphEmptyOverlayStyle}>
                <p style={graphEmptyTitleStyle}>当前没有可展示的拓扑关系</p>
                <p style={graphEmptyDetailStyle}>请检查实例采集状态，或点击右上角配置中的刷新。</p>
              </div>
            ) : null}
          </div>
        </div>
      )}
      {selectedNodeDetail ? (
        <div style={nodeDetailMaskStyle} onClick={() => setSelectedNodeKey(null)}>
          <div
            role="dialog"
            aria-label="节点详情"
            data-testid="topology-node-detail-dialog"
            style={nodeDetailDialogStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={nodeDetailHeadStyle}>
              <div>
                <h3 style={nodeDetailTitleStyle}>{selectedNodeDetail.title}</h3>
                <p style={nodeDetailSubtitleStyle}>{selectedNodeDetail.subtitle}</p>
              </div>
              <button type="button" style={nodeDetailCloseButtonStyle} onClick={() => setSelectedNodeKey(null)}>
                关闭
              </button>
            </div>
            <dl style={nodeDetailListStyle}>
              {selectedNodeDetail.rows.map((row) => (
                <div key={row.label} style={nodeDetailRowStyle}>
                  <dt style={nodeDetailKeyStyle}>{row.label}</dt>
                  <dd style={nodeDetailValueStyle}>{row.value}</dd>
                </div>
              ))}
            </dl>
            {selectedNodeDetail.action ? (
              <div style={nodeDetailActionBoxStyle}>
                <p style={nodeDetailActionTextStyle}>
                  {selectedNodeDetail.action.statusLabel} · {selectedNodeDetail.action.detail}
                </p>
                {selectedNodeDetail.action.href && selectedNodeDetail.action.actionLabel ? (
                  <a
                    href={selectedNodeDetail.action.href}
                    data-testid={selectedNodeDetail.linkTestId}
                    style={nodeDetailActionLinkStyle}
                  >
                    {selectedNodeDetail.action.actionLabel}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function InstanceTopology(): JSX.Element {
  return <TopologyCanvas />;
}

function getCanvasContainerStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minHeight: isMobile ? "calc(100dvh - 132px)" : "calc(100dvh - 72px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    isolation: "isolate",
    background: "#eef1f5",
    color: "#1f2933",
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  };
}

function getGraphSvgStyle(isPanning: boolean): CSSProperties {
  const cursor = isPanning ? "grabbing" : "grab";
  return {
    width: "100%",
    height: "100%",
    backgroundColor: "#f8fafc",
    backgroundImage: [
      "linear-gradient(rgba(148,163,184,0.16) 1px, transparent 1px)",
      "linear-gradient(90deg, rgba(148,163,184,0.16) 1px, transparent 1px)",
      "linear-gradient(rgba(148,163,184,0.09) 1px, transparent 1px)",
      "linear-gradient(90deg, rgba(148,163,184,0.09) 1px, transparent 1px)",
    ].join(", "),
    backgroundSize: "64px 64px, 64px 64px, 16px 16px, 16px 16px",
    borderRadius: 0,
    cursor,
    userSelect: "none",
  };
}

const controlsFabRootStyle: CSSProperties = {
  position: "absolute",
  top: "1rem",
  right: "1rem",
  zIndex: 40,
  display: "grid",
  justifyItems: "end",
  gap: "0.55rem",
};

const controlsPanelStyle: CSSProperties = {
  width: "min(320px, calc(100vw - 2rem))",
  borderRadius: "0.7rem",
  border: "1px solid rgba(201, 152, 76, 0.24)",
  background: "rgba(255, 255, 255, 0.95)",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
  padding: "0.55rem",
  display: "grid",
  gap: "0.55rem",
};

const controlsGroupStyle: CSSProperties = {
  display: "grid",
  gap: "0.42rem",
};

const controlsStatusRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
};

const fabToggleButtonStyle: CSSProperties = {
  width: "3.1rem",
  height: "3.1rem",
  borderRadius: "999px",
  border: "1px solid rgba(201, 152, 76, 0.38)",
  background: "rgba(255, 255, 255, 0.96)",
  color: "#1f2933",
  fontSize: "0.78rem",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 10px 18px rgba(15, 23, 42, 0.14)",
};

const controlButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.48rem 0.9rem",
  borderRadius: "0.5rem",
  fontSize: "0.8rem",
  fontWeight: 600,
  border: "1px solid rgba(201, 152, 76, 0.28)",
  cursor: "pointer",
  background: "rgba(255, 255, 255, 0.9)",
  color: "#1f2933",
  boxShadow: "0 6px 14px rgba(31, 41, 51, 0.06)",
};

const filterFieldStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.45rem",
};

const filterLabelStyle: CSSProperties = {
  fontSize: "0.78rem",
  color: "#6b7280",
};

const filterSelectStyle: CSSProperties = {
  borderRadius: "0.5rem",
  border: "1px solid rgba(148, 163, 184, 0.45)",
  background: "#fff",
  color: "#1f2933",
  padding: "0.3rem 0.5rem",
  fontSize: "0.8rem",
};

const filterSwitchStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.8rem",
  color: "#334155",
};

const realtimeStateStyle: CSSProperties = {
  fontSize: "0.76rem",
  color: "#475569",
  padding: "0.18rem 0.48rem",
  borderRadius: "999px",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  background: "rgba(248, 250, 252, 0.82)",
};

const realtimeHintStyle: CSSProperties = {
  fontSize: "0.72rem",
  color: "#64748b",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "11rem",
};

const eventCountStyle: CSSProperties = {
  marginLeft: "auto",
  fontSize: "0.78rem",
  color: "#64748b",
};

const contentRootStyle: CSSProperties = {
  position: "relative",
  minHeight: 0,
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
};

const graphShellStyle: CSSProperties = {
  width: `${GRAPH_W}px`,
  height: `${GRAPH_H}px`,
  maxWidth: "100%",
  maxHeight: "100%",
  aspectRatio: `${GRAPH_W} / ${GRAPH_H}`,
  position: "relative",
  overflow: "hidden",
  touchAction: "none",
};

const graphNodeLabelStyle: CSSProperties = {
  fill: "#0f172a",
  fontSize: "9px",
  fontWeight: 600,
  stroke: "rgba(248, 250, 252, 0.92)",
  strokeWidth: 2.2,
  paintOrder: "stroke",
};

const graphEmptyOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeContent: "center",
  textAlign: "center",
  gap: "0.45rem",
  background: "rgba(244, 241, 234, 0.72)",
  pointerEvents: "none",
};

const graphEmptyTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.95rem",
  color: "#1f2933",
  fontWeight: 600,
};

const graphEmptyDetailStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.78rem",
  color: "#64748b",
};

const graphNodeGroupStyle: CSSProperties = {
  cursor: "pointer",
};

const nodeDetailMaskStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 55,
  background: "rgba(15, 23, 42, 0.28)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
};

const nodeDetailDialogStyle: CSSProperties = {
  width: "min(560px, 96vw)",
  maxHeight: "84dvh",
  overflow: "auto",
  borderRadius: "0.85rem",
  border: "1px solid rgba(201, 152, 76, 0.28)",
  background: "#fff",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.2)",
  padding: "0.85rem",
  display: "grid",
  gap: "0.72rem",
};

const nodeDetailHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "0.8rem",
};

const nodeDetailTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  color: "#0f172a",
};

const nodeDetailSubtitleStyle: CSSProperties = {
  margin: "0.2rem 0 0",
  fontSize: "0.78rem",
  color: "#64748b",
};

const nodeDetailCloseButtonStyle: CSSProperties = {
  borderRadius: "0.45rem",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  background: "#f8fafc",
  color: "#334155",
  fontSize: "0.76rem",
  fontWeight: 600,
  padding: "0.35rem 0.58rem",
  cursor: "pointer",
};

const nodeDetailListStyle: CSSProperties = {
  display: "grid",
  gap: "0.45rem",
  margin: 0,
};

const nodeDetailRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  gap: "0.6rem",
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  paddingBottom: "0.35rem",
};

const nodeDetailKeyStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.74rem",
  color: "#64748b",
};

const nodeDetailValueStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "#1f2933",
  wordBreak: "break-word",
};

const nodeDetailActionBoxStyle: CSSProperties = {
  borderRadius: "0.65rem",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  background: "#f8fafc",
  padding: "0.55rem",
  display: "grid",
  gap: "0.45rem",
};

const nodeDetailActionTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.78rem",
  color: "#334155",
};

const nodeDetailActionLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.45rem",
  border: "1px solid rgba(37, 99, 235, 0.28)",
  background: "rgba(219, 234, 254, 0.65)",
  color: "#1d4ed8",
  textDecoration: "none",
  fontSize: "0.74rem",
  fontWeight: 700,
  padding: "0.36rem 0.55rem",
};

const stateContainerStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const panelBaseStyle: CSSProperties = {
  width: "min(440px, 92%)",
  borderRadius: "0.85rem",
  padding: "1.2rem 1rem",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  background: "rgba(255, 255, 255, 0.9)",
  boxShadow: "0 14px 30px rgba(15, 23, 42, 0.08)",
};

const emptyPanelStyle: CSSProperties = {
  ...panelBaseStyle,
  textAlign: "left",
};

const errorPanelStyle: CSSProperties = {
  ...panelBaseStyle,
  border: "1px solid rgba(239, 68, 68, 0.3)",
  background: "rgba(254, 242, 242, 0.92)",
};

const stateTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  color: "#1f2933",
};

const stateDetailStyle: CSSProperties = {
  margin: "0.45rem 0 0",
  fontSize: "0.8rem",
  color: "#64748b",
};

const errorTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  color: "#b91c1c",
};

const errorTextStyle: CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.8rem",
  color: "#7f1d1d",
};

const retryButtonStyle: CSSProperties = {
  marginTop: "0.75rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.5rem",
  border: "1px solid rgba(185, 28, 28, 0.35)",
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 600,
  padding: "0.42rem 0.86rem",
  cursor: "pointer",
  fontSize: "0.78rem",
};

const errorMetaListStyle: CSSProperties = {
  marginTop: "0.5rem",
  display: "grid",
  gap: "0.25rem",
};

const errorMetaStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.72rem",
  color: "#9f1239",
};

const errorHintStyle: CSSProperties = {
  margin: "0.2rem 0 0",
  fontSize: "0.72rem",
  color: "#7f1d1d",
};
