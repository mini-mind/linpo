import { useEffect, useState } from 'react';
import type React from 'react';
import { getNodeDetail } from '../api/client';
import type { EventRecord, NodeDetailResponse } from '../api/types';
import {
  activeIndicatorStyle,
  getStatusBadgeStyle,
  inactiveIndicatorStyle,
} from '../utils/statusStyles';

interface NodeDetailPanelProps {
  agentId: string;
  nodeId: string;
  onClose: () => void;
}

/**
 * NodeDetailPanel - Side panel showing node details and event history
 * 
 * Per architecture doc section 6: Node Details Panel
 * Per detailed design section 7.5: NodeDetailPanel
 * 
 * Displays:
 * - Name
 * - Current status
 * - Current is_active
 * - last_active_started_at
 * - Historical event records
 * 
 * Does NOT show: control buttons, resources, task cards, alerts
 */
export function NodeDetailPanel({
  agentId,
  nodeId,
  onClose,
}: NodeDetailPanelProps): JSX.Element {
  const [node, setNode] = useState<NodeDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setNode(null);

    let cancelled = false;

    async function fetchNode() {
      try {
        const data = await getNodeDetail(agentId, nodeId);
        if (!cancelled) {
          setNode(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch node');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchNode();

    return () => {
      cancelled = true;
    };
  }, [agentId, nodeId]);

  if (loading) {
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <h2 style={panelTitleStyle}>Node Details</h2>
          <button onClick={onClose} style={closeButtonStyle} type="button">×</button>
        </div>
        <p style={loadingStyle}>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <h2 style={panelTitleStyle}>Node Details</h2>
          <button onClick={onClose} style={closeButtonStyle} type="button">×</button>
        </div>
        <p style={errorStyle}>Error: {error}</p>
      </div>
    );
  }

  if (!node) {
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <h2 style={panelTitleStyle}>Node Details</h2>
          <button onClick={onClose} style={closeButtonStyle} type="button">×</button>
        </div>
        <p style={emptyStyle}>Node not found</p>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>Node Details</h2>
        <button onClick={onClose} style={closeButtonStyle} type="button">×</button>
      </div>

      <div style={contentStyle}>
        {/* Basic Info */}
        <section style={sectionStyle}>
          <h3 style={sectionTitleStyle}>{node.name}</h3>
          
          <div style={fieldGroupStyle}>
            <div style={fieldStyle}>
              <span style={fieldLabelStyle}>Status:</span>
              <span style={getStatusBadgeStyle(node.status)}>
                {node.status}
              </span>
            </div>
            
            <div style={fieldStyle}>
              <span style={fieldLabelStyle}>Active:</span>
              <span style={node.is_active ? activeIndicatorStyle : inactiveIndicatorStyle}>
                {node.is_active ? '● Active' : '○ Inactive'}
              </span>
            </div>
            
            <div style={fieldStyle}>
              <span style={fieldLabelStyle}>Last Active:</span>
              <span style={fieldValueStyle}>
                {node.last_active_started_at
                  ? formatTime(node.last_active_started_at)
                  : 'Never'}
              </span>
            </div>
          </div>
        </section>

        {/* Event History */}
        <section style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Event History</h3>
          
          {node.events.length === 0 ? (
            <p style={emptyEventsStyle}>No events recorded</p>
          ) : (
            <ul style={eventsListStyle}>
              {node.events.map((event) => (
                <EventItem key={event.id} event={event} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EventItem({ event }: { event: EventRecord }): JSX.Element {
  return (
    <li style={eventItemStyle}>
      <div style={eventHeaderStyle}>
        <span style={eventTypeStyle}>{formatEventType(event.type)}</span>
        <span style={eventTimeStyle}>{formatTime(event.timestamp)}</span>
      </div>
      <p style={eventDescriptionStyle}>{event.description}</p>
    </li>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function formatEventType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const panelStyle: React.CSSProperties = {
  background: '#fffdf8',
  border: '1px solid #d6cfc2',
  borderRadius: '0.5rem',
  padding: '1.5rem',
  minHeight: '100%',
  maxHeight: 'calc(100vh - 4rem)',
  overflow: 'auto',
};

const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '1.5rem',
  paddingBottom: '1rem',
  borderBottom: '1px solid #e5e7eb',
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  margin: 0,
  color: '#1f2933',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '1.5rem',
  color: '#6b7280',
  cursor: 'pointer',
  padding: '0.25rem',
  lineHeight: 1,
};

const contentStyle: React.CSSProperties = {};

const sectionStyle: React.CSSProperties = {
  marginBottom: '1.5rem',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#4b5563',
  margin: '0 0 0.75rem 0',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  minWidth: '6rem',
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#1f2933',
};

const eventsListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const eventItemStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: '#f9fafb',
  borderRadius: '0.375rem',
  border: '1px solid #f3f4f6',
};

const eventHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '0.25rem',
};

const eventTypeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: '#7c5e3c',
  textTransform: 'capitalize',
};

const eventTimeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#9ca3af',
};

const eventDescriptionStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#4b5563',
  margin: 0,
  lineHeight: 1.5,
};

const loadingStyle: React.CSSProperties = {
  color: '#6b7280',
  textAlign: 'center',
  padding: '2rem',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  textAlign: 'center',
  padding: '1rem',
};

const emptyStyle: React.CSSProperties = {
  color: '#6b7280',
  textAlign: 'center',
  padding: '2rem',
};

const emptyEventsStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontStyle: 'italic',
  fontSize: '0.875rem',
};
