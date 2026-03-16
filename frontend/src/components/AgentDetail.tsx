import { useEffect, useState } from 'react';
import type React from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAgentDetail } from '../api/client';
import type { AgentDetailResponse, TopologyNode } from '../api/types';
import { NodeDetailPanel } from './NodeDetailPanel';
import { TopologyTree } from './TopologyTree';
import {
  activeIndicatorStyle,
  getStatusBadgeStyle,
  inactiveIndicatorStyle,
} from '../utils/statusStyles';

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

    async function fetchAgent(id: string) {
      try {
        const data = await getAgentDetail(id);
        if (!cancelled) {
          setAgent(data);
          // Select root node by default
          const root = data.nodes.find((n) => n.id === data.root_node_id)
            ?? data.nodes.find((n) => n.parent_id === null);
          if (root) {
            setSelectedNode(root);
          }
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

    fetchAgent(agentId);

    return () => {
      cancelled = true;
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
