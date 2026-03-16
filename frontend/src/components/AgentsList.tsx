import { useEffect, useState } from 'react';
import type React from 'react';
import { Link } from 'react-router-dom';
import { listAgents } from '../api/client';
import type { AgentListItem } from '../api/types';
import {
  activeIndicatorStyle,
  getStatusBadgeStyle,
  inactiveIndicatorStyle,
} from '../utils/statusStyles';

/**
 * AgentsList page - v0.1 observer minimal implementation
 * 
 * Displays a pure list of agents with minimal fields:
 * - Name
 * - Status
 * - Is active
 * - Last active time
 * 
 * Per architecture doc section 7: "Agents 列表页采用纯列表形式"
 */
export function AgentsList(): JSX.Element {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAgents() {
      try {
        const data = await listAgents();
        if (!cancelled) {
          setAgents(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch agents');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchAgents();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={contentStyle}>
          <p style={textStyle}>Loading agents...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={contentStyle}>
          <p style={errorStyle}>Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={contentStyle}>
        <header style={headerStyle}>
          <h1 style={titleStyle}>Agents</h1>
          <p style={subtitleStyle}>Select an agent to view its topology</p>
        </header>

        <div style={listContainerStyle}>
          {agents.length === 0 ? (
            <p style={emptyStyle}>No agents found</p>
          ) : (
            <ul style={listStyle}>
              {agents.map((agent) => (
                <li key={agent.id} style={listItemStyle}>
                  <Link to={`/agents/${agent.id}`} style={linkStyle}>
                    <div style={rowStyle}>
                      <div style={nameCellStyle}>
                        <span style={nameStyle}>{agent.name}</span>
                      </div>
                      <div style={statusCellStyle}>
                        <span style={getStatusBadgeStyle(agent.status)}>
                          {agent.status}
                        </span>
                      </div>
                      <div style={activeCellStyle}>
                        <span style={agent.is_active ? activeIndicatorStyle : inactiveIndicatorStyle}>
                          {agent.is_active ? '● Active' : '○ Inactive'}
                        </span>
                      </div>
                      <div style={timeCellStyle}>
                        {agent.last_active_at ? (
                          <span style={timeStyle}>
                            {formatTime(agent.last_active_at)}
                          </span>
                        ) : (
                          <span style={noTimeStyle}>Never</span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
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
  maxWidth: '64rem',
  margin: '0 auto',
};

const headerStyle: React.CSSProperties = {
  marginBottom: '2rem',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 600,
  margin: '0 0 0.5rem 0',
  color: '#1f2933',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  margin: 0,
};

const listContainerStyle: React.CSSProperties = {
  background: '#fffdf8',
  border: '1px solid #d6cfc2',
  borderRadius: '0.5rem',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const listItemStyle: React.CSSProperties = {
  borderBottom: '1px solid #e5e7eb',
};

const linkStyle: React.CSSProperties = {
  display: 'block',
  padding: '1rem 1.5rem',
  textDecoration: 'none',
  color: 'inherit',
  transition: 'background-color 0.15s',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto auto',
  gap: '1.5rem',
  alignItems: 'center',
};

const nameCellStyle: React.CSSProperties = {
  minWidth: 0,
};

const nameStyle: React.CSSProperties = {
  fontWeight: 500,
  color: '#1f2933',
};

const statusCellStyle: React.CSSProperties = {};

const activeCellStyle: React.CSSProperties = {};

const timeCellStyle: React.CSSProperties = {
  minWidth: '10rem',
  textAlign: 'right',
};

const timeStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
};

const noTimeStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#9ca3af',
  fontStyle: 'italic',
};

const textStyle: React.CSSProperties = {
  color: '#6b7280',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
};

const emptyStyle: React.CSSProperties = {
  padding: '3rem',
  textAlign: 'center',
  color: '#6b7280',
};
