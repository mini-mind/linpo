import type React from 'react';
import type { TopologyNode } from '../api/types';
import {
  activeIndicatorStyle,
  getStatusBadgeStyle,
  inactiveIndicatorStyle,
} from '../utils/statusStyles';

interface TopologyTreeProps {
  nodes: TopologyNode[];
  selectedNodeId: string | null;
  onNodeSelect: (node: TopologyNode) => void;
}

/**
 * TopologyTree - Render agent/subagent hierarchy as a simple tree
 * 
 * Per architecture doc section 4 & 5:
 * - Full topology default display
 * - Nodes show: name, status, is_active, child_count
 * - Structure first, details on click
 * - No smart highlighting, no auto-focus
 * 
 * Per detailed design section 7.3: TopologyTree
 */
export function TopologyTree({
  nodes,
  selectedNodeId,
  onNodeSelect,
}: TopologyTreeProps): JSX.Element {
  // Build tree structure from flat nodes
  const rootNode = nodes.find((n) => n.parent_id === null);
  
  if (!rootNode) {
    return (
      <div style={emptyStyle}>
        <p>No topology data available</p>
      </div>
    );
  }

  function getChildren(nodeId: string): TopologyNode[] {
    return nodes.filter((n) => n.parent_id === nodeId);
  }

  function renderNode(node: TopologyNode, depth: number): JSX.Element {
    const children = getChildren(node.id);
    const isSelected = node.id === selectedNodeId;

    return (
      <div key={node.id} style={nodeContainerStyle}>
        <button
          onClick={() => onNodeSelect(node)}
          style={getNodeButtonStyle(isSelected, depth)}
          type="button"
        >
          <div style={nodeContentStyle}>
            <span style={nodeNameStyle}>{node.name}</span>
            <div style={nodeMetaStyle}>
              <span style={getStatusBadgeStyle(node.status)}>
                {node.status}
              </span>
              <span style={node.is_active ? activeIndicatorStyle : inactiveIndicatorStyle}>
                {node.is_active ? '● Active' : '○ Inactive'}
              </span>
              {node.child_count > 0 && (
                <span style={childCountStyle}>
                  {node.child_count} sub
                </span>
              )}
            </div>
          </div>
        </button>
        
        {children.length > 0 && (
          <div style={childrenContainerStyle}>
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={treeContainerStyle}>
      {renderNode(rootNode, 0)}
    </div>
  );
}

const treeContainerStyle: React.CSSProperties = {
  padding: '1rem',
};

const emptyStyle: React.CSSProperties = {
  padding: '2rem',
  textAlign: 'center',
  color: '#6b7280',
};

const nodeContainerStyle: React.CSSProperties = {
  marginBottom: '0.5rem',
};

const nodeContentStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  flexWrap: 'wrap',
};

const nodeNameStyle: React.CSSProperties = {
  fontWeight: 500,
  fontSize: '0.9375rem',
  color: '#1f2933',
  minWidth: '8rem',
};

const nodeMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
};

const childCountStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
};

const childrenContainerStyle: React.CSSProperties = {
  marginLeft: '1.5rem',
  marginTop: '0.5rem',
  paddingLeft: '1rem',
  borderLeft: '2px solid #e5e7eb',
};

function getNodeButtonStyle(isSelected: boolean, depth: number): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '0.75rem 1rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#d6cfc2',
    borderRadius: '0.375rem',
    background: '#fffdf8',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s',
    marginLeft: `${depth * 0}rem`, // Depth handled by childrenContainer
  };

  if (isSelected) {
    return {
      ...base,
      borderColor: '#7c5e3c',
      background: '#fefdfb',
      boxShadow: '0 0 0 2px rgba(124, 94, 60, 0.1)',
    };
  }

  return base;
}
