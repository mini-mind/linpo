import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listAgents } from '../api/client';
import type { AgentListItem } from '../api/types';
import { useIsMobile } from '../hooks/useIsMobile';
import { AgentWorkspace } from './AgentWorkspace';
import { InstanceList } from './InstanceList';

const LEFT_PANEL_WIDTH = 280;

export default function SessionPage(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  useEffect(() => {
    if (!isMobile) return;
    setAgentsLoading(true);
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setAgentsLoading(false));
  }, [isMobile]);

  const handleSelectInstance = (id: string): void => {
    navigate(`/session/${id}`);
  };

  const handleMobileSelect = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const selectedId = e.target.value;
    if (selectedId) {
      navigate(`/session/${selectedId}`);
    }
  };

  const selectedAgent = agents.find(a => a.id === agentId);

  if (isMobile) {
    return (
      <div style={mobileContainerStyle}>
        <div style={mobileHeaderStyle}>
          <select
            value={agentId ?? ''}
            onChange={handleMobileSelect}
            style={mobileSelectStyle}
            disabled={agentsLoading}
          >
            <option value="">{agentsLoading ? '加载中...' : '选择实例'}</option>
            {agents.map(agent => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          {selectedAgent && (
            <span style={mobileStatusStyle}>
              {selectedAgent.status === 'running' ? '● 运行中' : selectedAgent.status === 'idle' ? '○ 空闲' : selectedAgent.status}
            </span>
          )}
        </div>
        {agentId ? (
          <AgentWorkspace key={agentId} />
        ) : (
          <div style={mobilePlaceholderStyle}>
            <span style={mobilePlaceholderTextStyle}>请选择一个实例开始对话</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={getContainerStyle()}>
      <div style={getLayoutStyle()}>
        <div style={getLeftPanelStyle()}>
          <InstanceList
            selectedAgentId={agentId ?? null}
            onSelectAgent={handleSelectInstance}
          />
        </div>
        <div style={getRightPanelStyle()}>
          {agentId ? (
            <AgentWorkspace key={agentId} />
          ) : (
            <div style={placeholderStyle}>
              <span style={placeholderTextStyle}>选择一个实例开始对话</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const mobileContainerStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: '#fff',
};

const mobileHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.5rem 0.75rem',
  background: '#fff',
  borderBottom: '1px solid #e5e7eb',
};

const mobileSelectStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.5rem 0.75rem',
  fontSize: '0.9375rem',
  fontWeight: 500,
  borderRadius: '0.375rem',
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#1f2933',
};

const mobileStatusStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#6b7280',
};

const mobilePlaceholderStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f9fafb',
};

const mobilePlaceholderTextStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 500,
  color: '#9ca3af',
};

const placeholderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  width: '100%',
  background: '#f9fafb',
};

const placeholderTextStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 500,
  color: '#9ca3af',
};

function getContainerStyle(): React.CSSProperties {
  return {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#f4f1ea',
    color: '#1f2933',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  };
}

function getLayoutStyle(): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'row',
    flex: 1,
    overflow: 'hidden',
  };
}

function getLeftPanelStyle(): React.CSSProperties {
  return {
    width: `${LEFT_PANEL_WIDTH}px`,
    minWidth: `${LEFT_PANEL_WIDTH}px`,
    borderRight: '1px solid #e5e7eb',
    background: '#f9fafb',
    flexShrink: 0,
    overflow: 'hidden',
  };
}

function getRightPanelStyle(): React.CSSProperties {
  return {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };
}
