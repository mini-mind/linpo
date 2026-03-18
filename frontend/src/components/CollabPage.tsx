import type React from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

function getContainerStyle(isMobile: boolean): React.CSSProperties {
  return {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: isMobile ? '1rem' : '2rem',
    background: '#f4f1ea',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  };
}

function getCardStyle(isMobile: boolean): React.CSSProperties {
  return {
    background: '#fff',
    borderRadius: '0.75rem',
    padding: isMobile ? '2rem 1.5rem' : '3rem 2.5rem',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%',
  };
}

const titleStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 600,
  color: '#1f2933',
  margin: '0 0 0.75rem 0',
};

const messageStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#6b7280',
  margin: '0 0 1.5rem 0',
  lineHeight: 1.6,
};

const iconStyle: React.CSSProperties = {
  fontSize: '3rem',
  marginBottom: '1rem',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.25rem 0.75rem',
  borderRadius: '9999px',
  fontSize: '0.75rem',
  fontWeight: 500,
  background: '#dbeafe',
  color: '#1e40af',
};

export default function CollabPage(): JSX.Element {
  const isMobile = useIsMobile();

  return (
    <div style={getContainerStyle(isMobile)}>
      <div style={getCardStyle(isMobile)}>
        <div style={iconStyle}>📋</div>
        <h1 style={titleStyle}>协作</h1>
        <p style={messageStyle}>任务看板功能开发中，敬请期待</p>
        <span style={badgeStyle}>即将推出</span>
      </div>
    </div>
  );
}
