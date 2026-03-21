import type React from 'react';

import { useIsMobile } from '../hooks/useIsMobile';

interface SessionActionsProps {
  sessionKey: string;
  onReset?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onPause?: () => Promise<void>;
  showPauseButton?: boolean;
  isPausing?: boolean;
  disabled?: boolean;
}

export function SessionActions({ sessionKey }: SessionActionsProps): JSX.Element {
  const isMobile = useIsMobile();

  return (
    <div style={containerStyle}>
      <div style={hintStyle}>
        <span style={hintTitleStyle}>只读观察</span>
        <span style={hintTextStyle}>当前阶段仅保留观察与进入能力</span>
      </div>
      {sessionKey ? (
        <div style={getMetaStyle(isMobile)}>
          <span style={metaLabelStyle}>当前会话</span>
          <span style={metaValueStyle}>{sessionKey}</span>
        </div>
      ) : null}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const hintStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  padding: '0.75rem 0.875rem',
  borderRadius: '0.75rem',
  border: '1px solid #e5e7eb',
  background: '#f8fafc',
};

const hintTitleStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#475569',
};

const hintTextStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#1f2937',
  lineHeight: 1.5,
};

function getMetaStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    gap: isMobile ? '0.25rem' : '0.5rem',
    alignItems: isMobile ? 'flex-start' : 'center',
    padding: '0 0.125rem',
  };
}

const metaLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#64748b',
};

const metaValueStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#0f172a',
  wordBreak: 'break-all',
};
