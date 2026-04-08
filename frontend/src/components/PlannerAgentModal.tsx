import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAggregateOverview } from '../api/client';
import type { AggregateOverviewAgentItem } from '../api/types';
import { useCurrentInstanceId } from '../hooks/useCurrentInstance';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePlannerAgentPreference } from '../hooks/usePlannerAgentPreference';
import { useToast } from '../hooks/useToast';
import { listUniqueAgents } from './flowAgentScopeUtils';

type PlannerAgentModalProps = {
  open: boolean;
  onClose: () => void;
};

export function PlannerAgentModal({ open, onClose }: PlannerAgentModalProps): JSX.Element | null {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [currentInstanceId] = useCurrentInstanceId();
  const [storedPlannerAgentId, setStoredPlannerAgentId] = usePlannerAgentPreference(currentInstanceId);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [availableAgents, setAvailableAgents] = useState<AggregateOverviewAgentItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');

  const normalizedCurrentInstanceId = currentInstanceId?.trim() ?? '';
  const hasCurrentInstance = normalizedCurrentInstanceId !== '';

  const sortedAgents = useMemo(() => {
    return [...availableAgents].sort((left, right) => {
      const leftLabel = (left.agent_name.trim() || left.agent_id).toLowerCase();
      const rightLabel = (right.agent_name.trim() || right.agent_id).toLowerCase();
      return leftLabel.localeCompare(rightLabel);
    });
  }, [availableAgents]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedAgentId(storedPlannerAgentId ?? '');
  }, [open, storedPlannerAgentId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!hasCurrentInstance) {
      setAvailableAgents([]);
      setErrorText(null);
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    setErrorText(null);
    void getAggregateOverview({ instanceId: normalizedCurrentInstanceId })
      .then((overview) => {
        if (!active) {
          return;
        }
        const candidates = listUniqueAgents(overview.agents).filter(
          (agent) => agent.instance_id.trim() === normalizedCurrentInstanceId
        );
        setAvailableAgents(candidates);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : '读取可用 Agent 失败';
        setErrorText(message);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [hasCurrentInstance, normalizedCurrentInstanceId, open]);

  const handleSave = useCallback(() => {
    if (!hasCurrentInstance) {
      addToast('请先选择实例，再配置 Planner Agent', 'warning');
      return;
    }
    const normalizedSelectedAgentId = selectedAgentId.trim();
    if (!normalizedSelectedAgentId) {
      addToast('请选择 Planner Agent', 'warning');
      return;
    }
    if (!availableAgents.some((agent) => agent.agent_id.trim() === normalizedSelectedAgentId)) {
      addToast('所选 Agent 不在当前实例可用列表中', 'warning');
      return;
    }
    setStoredPlannerAgentId(normalizedSelectedAgentId);
    addToast('默认 Planner Agent 已保存', 'success');
    onClose();
  }, [addToast, availableAgents, hasCurrentInstance, onClose, selectedAgentId, setStoredPlannerAgentId]);

  if (!open) {
    return null;
  }

  const modal = (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Planner Agent 配置">
      <div style={backdropStyle} onClick={onClose} aria-hidden="true" />
      <section style={panelStyle}>
        <header style={headerStyle}>
          <h3 style={titleStyle}>Planner Agent</h3>
          <button type="button" style={closeButtonStyle} onClick={onClose} aria-label="关闭 Planner Agent 配置">
            ×
          </button>
        </header>
        <div style={isMobile ? contentMobileStyle : contentStyle}>
          <p style={hintTextStyle}>
            当前实例: {hasCurrentInstance ? normalizedCurrentInstanceId : '未选择'}
          </p>
          {!hasCurrentInstance ? (
            <p style={warningTextStyle}>请先在“实例”中切换当前实例，再配置默认 Planner Agent。</p>
          ) : null}
          {errorText ? <p style={errorTextStyle}>{errorText}</p> : null}
          <label style={fieldLabelStyle} htmlFor="planner-agent-select">默认 Planner Agent</label>
          <select
            id="planner-agent-select"
            style={selectStyle}
            value={selectedAgentId}
            onChange={(event) => setSelectedAgentId(event.target.value)}
            disabled={!hasCurrentInstance || isLoading || sortedAgents.length === 0}
          >
            <option value="">{isLoading ? '加载中...' : '请选择 Agent'}</option>
            {sortedAgents.map((agent) => {
              const agentName = agent.agent_name.trim() || agent.agent_id;
              const agentId = agent.agent_id.trim();
              return (
                <option key={agentId} value={agentId}>
                  {agentName} ({agentId})
                </option>
              );
            })}
          </select>
          {hasCurrentInstance && !isLoading && sortedAgents.length === 0 && !errorText ? (
            <p style={warningTextStyle}>当前实例下没有可用 Agent。</p>
          ) : null}
        </div>
        <footer style={footerStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>取消</button>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={handleSave}
            disabled={!hasCurrentInstance || isLoading || sortedAgents.length === 0}
          >
            保存
          </button>
        </footer>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 220,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
};

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.46)',
  backdropFilter: 'blur(2px)',
};

const panelStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(460px, 100%)',
  maxHeight: 'calc(100dvh - 2rem)',
  overflow: 'hidden',
  borderRadius: '0.95rem',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 24px 56px -28px rgba(15, 23, 42, 0.45)',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.9rem 1rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.26)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 600,
  color: '#10212f',
};

const closeButtonStyle: React.CSSProperties = {
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.36)',
  background: 'rgba(255, 255, 255, 0.95)',
  color: '#334155',
  fontSize: '1rem',
  lineHeight: 1,
  cursor: 'pointer',
};

const contentStyle: React.CSSProperties = {
  padding: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.62rem',
};

const contentMobileStyle: React.CSSProperties = {
  ...contentStyle,
  padding: '0.85rem',
};

const hintTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#334155',
};

const warningTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#b45309',
};

const errorTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#b91c1c',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#0f172a',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: '0.6rem',
  border: '1px solid rgba(148, 163, 184, 0.46)',
  background: '#fff',
  color: '#0f172a',
  padding: '0.55rem 0.7rem',
  fontSize: '0.86rem',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.55rem',
  padding: '0.85rem 1rem 1rem',
  borderTop: '1px solid rgba(148, 163, 184, 0.2)',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '0.45rem 0.82rem',
  borderRadius: '0.55rem',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  background: '#fff',
  color: '#334155',
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: '0.55rem',
  border: '1px solid rgba(14, 116, 144, 0.4)',
  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.9), rgba(14, 165, 233, 0.92))',
  color: '#fff',
  fontSize: '0.82rem',
  fontWeight: 600,
  cursor: 'pointer',
};
