import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAgentDetail, getDefaultObserverDataSource } from '../api/client';
import {
  createObserverRealtimeClient,
  type ObserverRealtimeClient,
  type ObserverRealtimeClientOptions,
} from '../api/realtimeClient';
import {
  buildAgentDetailChannel,
  type AgentDetailResponse,
  type TopologyNode,
} from '../api/types';
import { NodeDetailPanel } from './NodeDetailPanel';
import { TopologyTree } from './TopologyTree';
import {
  activeIndicatorStyle,
  getStatusBadgeStyle,
  inactiveIndicatorStyle,
} from '../utils/statusStyles';

type RealtimeStatus = 'realtime' | 'reconnecting' | 'resyncing' | 'disconnected' | 'error';

interface RealtimeState {
  status: RealtimeStatus;
  message: string | null;
}

type AgentDetailUpdate =
  | AgentDetailResponse
  | null
  | ((previous: AgentDetailResponse | null) => AgentDetailResponse | null);

interface StartAgentDetailRealtimeOptions {
  agentId: string;
  getAgentDetailFn: (agentId: string) => Promise<AgentDetailResponse>;
  createRealtimeClientFn: (options: ObserverRealtimeClientOptions) => ObserverRealtimeClient;
  applyAgent: (update: AgentDetailUpdate) => void;
  getSelectedNode: () => TopologyNode | null;
  setSelectedNode: (node: TopologyNode | null) => void;
  setRealtimeState?: (state: RealtimeState) => void;
}

const AGENT_DETAIL_REALTIME_DATA_SOURCE = getDefaultObserverDataSource();

function withErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function findRootNode(nodes: TopologyNode[], rootNodeId: string): TopologyNode | null {
  return nodes.find((node) => node.id === rootNodeId)
    ?? nodes.find((node) => node.parent_id === null)
    ?? nodes[0]
    ?? null;
}

function convergeSelectedNode(
  nodes: TopologyNode[],
  rootNodeId: string,
  selectedNode: TopologyNode | null
): TopologyNode | null {
  if (selectedNode) {
    const nextSelectedNode = nodes.find((node) => node.id === selectedNode.id);
    if (nextSelectedNode) {
      return nextSelectedNode;
    }
  }
  return findRootNode(nodes, rootNodeId);
}

function mergeAgentDetailTopology(
  previous: AgentDetailResponse,
  nextNodes: TopologyNode[]
): AgentDetailResponse {
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

export async function startAgentDetailRealtime(
  options: StartAgentDetailRealtimeOptions
): Promise<{ close: () => void } | null> {
  let latestAgent: AgentDetailResponse | null = null;

  const applySnapshot = (snapshot: AgentDetailResponse): void => {
    latestAgent = snapshot;
    options.applyAgent(snapshot);
    options.setSelectedNode(
      convergeSelectedNode(snapshot.nodes, snapshot.root_node_id, options.getSelectedNode())
    );
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
      options.setRealtimeState?.({
        status: 'error',
        message: withErrorMessage(error, 'Failed to resync agent detail'),
      });
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
          if (!latestAgent) {
            return;
          }

          const nextAgent = mergeAgentDetailTopology(latestAgent, message.payload.nodes);
          latestAgent = nextAgent;
          options.applyAgent(nextAgent);
          options.setSelectedNode(
            convergeSelectedNode(nextAgent.nodes, nextAgent.root_node_id, options.getSelectedNode())
          );
          options.setRealtimeState?.({ status: 'realtime', message: null });
          return;
        }

        if (message.type === 'error') {
          options.setRealtimeState?.({ status: 'error', message: message.payload.detail });
        }
      },
      onResyncRequired: () => {
        void runResync();
      },
      onParseError: (_raw, error) => {
        options.setRealtimeState?.({
          status: 'error',
          message: withErrorMessage(error, 'Failed to parse realtime message'),
        });
      },
      onDisconnected: () => {
        options.setRealtimeState?.({
          status: 'disconnected',
          message: 'Realtime connection closed unexpectedly',
        });
      },
    });

    realtimeClient.connect();
    return realtimeClient;
  } catch (error) {
    options.setRealtimeState?.({
      status: 'error',
      message: withErrorMessage(error, 'Failed to connect realtime channel'),
    });
    return null;
  }
}

function formatRealtimeStatus(status: RealtimeStatus): string {
  if (status === 'realtime') {
    return 'realtime';
  }
  if (status === 'reconnecting') {
    return 'reconnecting';
  }
  if (status === 'resyncing') {
    return 'resyncing';
  }
  if (status === 'disconnected') {
    return 'disconnected';
  }
  return 'error';
}

/**
 * AgentDetail page - v0.1 observer with topology and node details
 * 
 * Displays:
 * - Agent header with name, status, meta
 * - Full topology tree (root + subagents)
 * - Node detail side panel when a node is selected
 * 
 * Per architecture doc section 6.3: Agent 详情页
 * Per detailed design section 7.2: AgentDetailPage
 */
export function AgentDetail(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const [agent, setAgent] = useState<AgentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const selectedNodeRef = useRef<TopologyNode | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>({
    status: 'reconnecting',
    message: null,
  });

  useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);

  useEffect(() => {
    // Handle missing agentId early
    if (!agentId) {
      setError('No agent ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setAgent(null);
    setSelectedNode(null);

    let cancelled = false;
    let realtimeHandle: { close: () => void } | null = null;

    async function loadSnapshotAndSubscribe(id: string) {
      try {
        const handle = await startAgentDetailRealtime({
          agentId: id,
          getAgentDetailFn: getAgentDetail,
          createRealtimeClientFn: createObserverRealtimeClient,
          applyAgent: (update) => {
            if (cancelled) {
              return;
            }
            setAgent((previousAgent) =>
              typeof update === 'function' ? update(previousAgent) : update
            );
          },
          getSelectedNode: () => selectedNodeRef.current,
          setSelectedNode: (node) => {
            if (!cancelled) {
              selectedNodeRef.current = node;
              setSelectedNode(node);
            }
          },
          setRealtimeState: (state) => {
            if (!cancelled) {
              setRealtimeState(state);
            }
          }
        });

        if (!cancelled) {
          realtimeHandle = handle;
        } else {
          handle?.close();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch agent');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSnapshotAndSubscribe(agentId);

    return () => {
      cancelled = true;
      realtimeHandle?.close();
    };
  }, [agentId]);

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={contentStyle}>
          <p style={textStyle}>Loading agent...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={contentStyle}>
          <p style={errorStyle}>Error: {error}</p>
          <Link to="/" style={backLinkStyle}>← Back to agents list</Link>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div style={containerStyle}>
        <div style={contentStyle}>
          <p style={textStyle}>Agent not found</p>
          <Link to="/" style={backLinkStyle}>← Back to agents list</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={contentStyle}>
        {/* Header */}
        <header style={headerStyle}>
          <div style={headerTopStyle}>
            <Link to="/" style={backLinkStyle}>← Back to agents list</Link>
          </div>
          <div style={headerMainStyle}>
            <h1 style={titleStyle}>{agent.name}</h1>
            <div style={metaStyle}>
              <span style={getStatusBadgeStyle(agent.status)}>
                {agent.status}
              </span>
              <span style={agent.is_active ? activeIndicatorStyle : inactiveIndicatorStyle}>
                {agent.is_active ? '● Active' : '○ Inactive'}
              </span>
              <span style={nodesCountStyle}>
                {agent.total_node_count} node{agent.total_node_count !== 1 ? 's' : ''} total · {agent.root_child_count} direct child{agent.root_child_count !== 1 ? 'ren' : ''}
              </span>
            </div>
            <p style={realtimeMetaStyle}>
              Realtime ({AGENT_DETAIL_REALTIME_DATA_SOURCE}): {formatRealtimeStatus(realtimeState.status)}
              {realtimeState.message ? ` - ${realtimeState.message}` : ''}
            </p>
          </div>
        </header>

        {/* Main content: Topology + Side panel */}
        <div style={mainAreaStyle}>
          {/* Topology Tree */}
          <div style={topologyContainerStyle}>
            <h2 style={sectionTitleStyle}>Topology</h2>
            <div style={treeWrapperStyle}>
              <TopologyTree
                nodes={agent.nodes}
                selectedNodeId={selectedNode?.id ?? null}
                onNodeSelect={setSelectedNode}
              />
            </div>
          </div>

          {/* Node Detail Panel */}
          <div style={panelContainerStyle}>
            {selectedNode && agentId ? (
              <NodeDetailPanel
                agentId={agentId}
                nodeId={selectedNode.id}
                onClose={() => setSelectedNode(null)}
              />
            ) : (
              <div style={emptyPanelStyle}>
                <p style={emptyPanelTextStyle}>Select a node to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Styles - minimal, clean, structure-first
const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: '#f4f1ea',
  color: '#1f2933',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const contentStyle: React.CSSProperties = {
  maxWidth: '80rem',
  margin: '0 auto',
};

const headerStyle: React.CSSProperties = {
  marginBottom: '2rem',
};

const headerTopStyle: React.CSSProperties = {
  marginBottom: '1rem',
};

const headerMainStyle: React.CSSProperties = {};

const titleStyle: React.CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 600,
  margin: '0 0 0.75rem 0',
  color: '#1f2933',
};

const metaStyle: React.CSSProperties = {
  display: 'flex',
  gap: '1rem',
  alignItems: 'center',
};

const realtimeMetaStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: '#4b5563',
  margin: '0.5rem 0 0 0',
};

const backLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  color: '#6b7280',
  textDecoration: 'none',
  fontSize: '0.875rem',
};

const mainAreaStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 24rem',
  gap: '2rem',
  alignItems: 'start',
};

const topologyContainerStyle: React.CSSProperties = {
  background: '#fffdf8',
  border: '1px solid #d6cfc2',
  borderRadius: '0.5rem',
  padding: '1.5rem',
  minHeight: '30rem',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  margin: '0 0 1rem 0',
  color: '#1f2933',
};

const treeWrapperStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '0.375rem',
  background: '#fafaf9',
};

const panelContainerStyle: React.CSSProperties = {};

const emptyPanelStyle: React.CSSProperties = {
  background: '#fffdf8',
  border: '1px solid #d6cfc2',
  borderRadius: '0.5rem',
  padding: '2rem',
  textAlign: 'center',
  minHeight: '20rem',
};

const emptyPanelTextStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontStyle: 'italic',
};

const nodesCountStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
};

const textStyle: React.CSSProperties = {
  color: '#6b7280',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
};
