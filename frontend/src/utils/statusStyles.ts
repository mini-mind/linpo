import type React from 'react';

export type AgentStatus = 'idle' | 'running' | 'finished' | 'error';

const STATUS_COLORS: Record<AgentStatus, { bg: string; text: string }> = {
  idle: { bg: '#f3f4f6', text: '#6b7280' },
  running: { bg: '#dcfce7', text: '#166534' },
  finished: { bg: '#dbeafe', text: '#1e40af' },
  error: { bg: '#fee2e2', text: '#dc2626' },
};

/**
 * Get badge styles for status display
 * Used in AgentsList and AgentDetail for consistent status badges
 */
export function getStatusBadgeStyle(status: AgentStatus): React.CSSProperties {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.idle;
  
  return {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 500,
    textTransform: 'capitalize',
    background: colors.bg,
    color: colors.text,
  };
}

/**
 * Get text color style for status (inline display)
 */
export function getStatusTextStyle(status: AgentStatus): React.CSSProperties {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.idle;
  
  return {
    fontSize: '0.75rem',
    textTransform: 'capitalize',
    color: colors.text,
  };
}

/**
 * Active indicator styles
 */
export const activeIndicatorStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#16a34a',
};

export const inactiveIndicatorStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#9ca3af',
};
