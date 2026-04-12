import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstanceItem, InstanceTokenUsageDailyPoint, InstanceTokenUsageResponse } from '../api/types';
import { getInstanceTokenUsage, resolveSingleInstance } from '../api/instanceClient';
import { ApiError } from '../api/client';

type AccountMenuProps = {
  compact?: boolean;
  menuPlacement?: 'above' | 'below';
  triggerVariant?: 'username' | 'icon';
};

export function AccountMenu({
  compact = false,
  menuPlacement = 'above',
  triggerVariant = 'username',
}: AccountMenuProps = {}): JSX.Element {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [instance, setInstance] = useState<InstanceItem | null>(null);
  const [instanceCount, setInstanceCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<InstanceTokenUsageResponse | null>(null);
  const [tokenUsageLoading, setTokenUsageLoading] = useState(false);
  const [tokenUsageError, setTokenUsageError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  const loadTokenUsage = useCallback(async (instanceId: string) => {
    setTokenUsageLoading(true);
    setTokenUsageError(null);
    try {
      const usage = await getInstanceTokenUsage(instanceId, { days: 7 });
      setTokenUsage(usage);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setTokenUsageError('Token 用量服务暂不可用（503）');
        return;
      }
      setTokenUsage(null);
      setTokenUsageError(error instanceof Error ? error.message : '读取今日用量失败');
    } finally {
      setTokenUsageLoading(false);
    }
  }, []);

  const loadInstance = useCallback(async () => {
    try {
      const result = await resolveSingleInstance();
      setInstance(result.instance);
      setInstanceCount(result.total);
      setLoadError(null);
      if (result.instance?.id) {
        void loadTokenUsage(result.instance.id);
      } else {
        setTokenUsage(null);
        setTokenUsageLoading(false);
        setTokenUsageError(null);
      }
    } catch (error) {
      setInstance(null);
      setInstanceCount(null);
      setLoadError(error instanceof Error ? error.message : '读取实例失败');
      setTokenUsage(null);
      setTokenUsageLoading(false);
      setTokenUsageError(null);
    }
  }, [loadTokenUsage]);

  const toggleMenu = useCallback(() => {
    setIsMenuOpen((prev) => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleMenu();
      }
    },
    [toggleMenu]
  );

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        triggerButtonRef.current?.focus();
      }
    },
    [closeMenu]
  );

  useEffect(() => {
    void loadInstance();
  }, [loadInstance]);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen, closeMenu]);

  return (
    <div style={getContainerStyle(compact)} ref={menuRef}>
      <button
        type="button"
        onClick={toggleMenu}
        onKeyDown={handleTriggerKeyDown}
        style={getTriggerButtonStyle(compact)}
        aria-label="打开实例信息"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        ref={triggerButtonRef}
      >
        {triggerVariant === 'icon' ? (
          <span style={triggerIconShellStyle} aria-hidden="true">
            <img src="/assets/brand/openclaw-icon.svg" alt="" style={triggerIconImageStyle} />
          </span>
        ) : null}
        <span style={triggerLabelStyle}>{resolveTriggerLabel(instance, instanceCount)}</span>
      </button>

      {isMenuOpen && (
        <div style={getMenuStyle(menuPlacement)} role="menu" aria-label="实例信息" onKeyDown={handleMenuKeyDown}>
          <div style={menuHeaderStyle}>当前 OpenClaw 实例</div>
          {renderInstanceDetail(instance, instanceCount, loadError, tokenUsage, tokenUsageLoading, tokenUsageError)}
          <button
            type="button"
            style={refreshButtonStyle}
            role="menuitem"
            onClick={() => {
              void loadInstance();
            }}
          >
            刷新实例信息
          </button>
        </div>
      )}
    </div>
  );
}

function resolveTriggerLabel(instance: InstanceItem | null, count: number | null): string {
  if (instance?.name?.trim()) {
    return instance.name.trim();
  }
  if (count === null) {
    return '实例信息';
  }
  if (count === 0) {
    return '未配置实例';
  }
  if (count > 1) {
    return `实例异常 (${count})`;
  }
  return '实例信息';
}

function renderInstanceDetail(
  instance: InstanceItem | null,
  count: number | null,
  loadError: string | null,
  tokenUsage: InstanceTokenUsageResponse | null,
  tokenUsageLoading: boolean,
  tokenUsageError: string | null
): JSX.Element {
  if (loadError) {
    return <p style={hintStyle}>读取失败：{loadError}</p>;
  }

  if (!instance && count === 0) {
    return <p style={hintStyle}>未检测到实例，请先在服务端配置 1 个 OpenClaw 实例。</p>;
  }

  if (!instance && typeof count === 'number' && count > 1) {
    return <p style={hintStyle}>检测到 {count} 个实例。当前版本仅支持单实例，请保留 1 个。</p>;
  }

  if (!instance) {
    return <p style={hintStyle}>正在读取实例信息...</p>;
  }

  return (
    <dl style={detailListStyle}>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>名称</dt>
        <dd style={detailValueStyle}>{instance.name || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>ID</dt>
        <dd style={detailValueStyle}>{instance.id || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>类型</dt>
        <dd style={detailValueStyle}>{instance.type || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>Endpoint</dt>
        <dd style={detailValueStyle}>{instance.endpoint || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>状态</dt>
        <dd style={detailValueStyle}>{instance.status || '-'}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>今日用量</dt>
        <dd style={detailValueStyle}>{renderTodayUsage(tokenUsage, tokenUsageLoading, tokenUsageError)}</dd>
      </div>
      <div style={detailRowStyle}>
        <dt style={detailKeyStyle}>7天曲线</dt>
        <dd style={chartValueStyle}>{renderUsageSparkline(tokenUsage, tokenUsageLoading, tokenUsageError)}</dd>
      </div>
    </dl>
  );
}

function renderTodayUsage(
  tokenUsage: InstanceTokenUsageResponse | null,
  loading: boolean,
  error: string | null
): string {
  if (loading) {
    return '加载中...';
  }
  if (error) {
    return `读取失败：${error}`;
  }
  const today = tokenUsage?.today;
  if (!today) {
    return '暂无数据';
  }
  // 后端 today 可能缺 total，仅给 input/output；这里统一合并，避免把缺失值直接渲染成 0。
  const total = resolveTotalTokens(today.total_tokens, today.input_tokens, today.output_tokens);
  if (total === null) {
    return '暂无数据';
  }
  const parts: string[] = [];
  if (today.input_tokens !== null) {
    parts.push(`输入 ${formatTokenCount(today.input_tokens)}`);
  }
  if (today.output_tokens !== null) {
    parts.push(`输出 ${formatTokenCount(today.output_tokens)}`);
  }
  if (parts.length === 0) {
    return `总 ${formatTokenCount(total)}`;
  }
  return `总 ${formatTokenCount(total)}（${parts.join(' / ')}）`;
}

function renderUsageSparkline(
  tokenUsage: InstanceTokenUsageResponse | null,
  loading: boolean,
  error: string | null
): JSX.Element {
  if (loading) {
    return <span style={hintStyle}>加载中...</span>;
  }
  if (error) {
    return <span style={hintStyle}>读取失败：{error}</span>;
  }
  const daily = tokenUsage?.daily;
  if (!daily || daily.length === 0) {
    return <span style={hintStyle}>暂无最近7天数据</span>;
  }
  const recent = buildRecentSevenDaySeries(daily);

  const width = 210;
  const height = 54;
  const innerHeight = height - 10;
  const pointCount = Math.max(1, recent.length - 1);
  const values = recent.map((item) => resolveTotalTokens(item.total_tokens, item.input_tokens, item.output_tokens) ?? 0);
  const maxValue = Math.max(...values, 1);
  const points = recent
    .map((_, index) => {
      const x = (index / pointCount) * width;
      const y = innerHeight - (values[index] / maxValue) * innerHeight + 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div style={sparklineWrapStyle}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={sparklineSvgStyle}
        role="img"
        aria-label="最近7天Token用量曲线"
      >
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="rgba(148, 163, 184, 0.45)" strokeWidth="1" />
        <polyline fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
        {recent.map((value, index) => {
          const x = (index / pointCount) * width;
          const y = innerHeight - (values[index] / maxValue) * innerHeight + 2;
          const isMissing = resolveTotalTokens(value.total_tokens, value.input_tokens, value.output_tokens) === null;
          return (
            <circle
              key={`${recent[index].date}:${index}`}
              cx={x}
              cy={y}
              r="2.1"
              fill={isMissing ? '#94a3b8' : '#0284c7'}
              opacity={isMissing ? 0.7 : 1}
            />
          );
        })}
      </svg>
      <div style={sparklineLabelStyle}>
        <span>{formatDailyLabel(recent[0])}</span>
        <span>{formatDailyLabel(recent[recent.length - 1])}</span>
      </div>
    </div>
  );
}

function buildRecentSevenDaySeries(daily: InstanceTokenUsageDailyPoint[]): InstanceTokenUsageDailyPoint[] {
  const byDate = new Map<string, InstanceTokenUsageDailyPoint>();
  daily.forEach((point) => {
    const normalizedDate = normalizeDailyDate(point.date);
    if (!normalizedDate) {
      return;
    }
    byDate.set(normalizedDate, { ...point, date: normalizedDate });
  });

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const recent: InstanceTokenUsageDailyPoint[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const cursor = new Date(todayUtc);
    cursor.setUTCDate(todayUtc.getUTCDate() - offset);
    const dateKey = cursor.toISOString().slice(0, 10);
    // 对最近 7 天中缺失的日期补 0，保证“近7天曲线”固定 7 个点且连续可读。
    recent.push(
      byDate.get(dateKey) ?? {
        date: dateKey,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      }
    );
  }
  return recent;
}

function normalizeDailyDate(value: string): string | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDailyLabel(point: InstanceTokenUsageDailyPoint): string {
  const value = point.date.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.slice(5);
  }
  return value || '-';
}

function resolveTotalTokens(total: number | null, input: number | null, output: number | null): number | null {
  if (typeof total === 'number') {
    return total;
  }
  if (typeof input === 'number' || typeof output === 'number') {
    return (input ?? 0) + (output ?? 0);
  }
  return null;
}

function formatTokenCount(value: number): string {
  return value.toLocaleString('zh-CN');
}

function getContainerStyle(compact: boolean): React.CSSProperties {
  if (compact) {
    return {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
  }
  return {
    position: 'relative',
    padding: '0.75rem 0.5rem',
    margin: '0 0.5rem 0.5rem 0.5rem',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };
}

function getTriggerButtonStyle(compact: boolean): React.CSSProperties {
  if (compact) {
    return {
      height: '2.125rem',
      maxWidth: '14rem',
      borderRadius: '999px',
      position: 'relative',
      border: '1px solid #dbe4ef',
      background: 'rgba(255, 255, 255, 0.95)',
      color: '#0f172a',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.4rem',
      cursor: 'pointer',
      fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      boxShadow: '0 10px 24px -20px rgba(15, 23, 42, 0.6)',
      padding: '0 0.65rem 0 0.35rem',
    };
  }
  return {
    padding: '0.375rem 0.5rem',
    background: 'transparent',
    border: 'none',
    position: 'relative',
    color: '#1f2933',
    fontSize: '0.75rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    width: '100%',
    textAlign: 'center',
    borderRadius: '0.375rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.45rem',
  };
}

function getMenuStyle(menuPlacement: 'above' | 'below'): React.CSSProperties {
  return {
    position: 'absolute',
    ...(menuPlacement === 'above'
      ? { bottom: 'calc(100% + 0.5rem)' }
      : { top: 'calc(100% + 0.5rem)' }),
    right: 0,
    minWidth: '19rem',
    maxWidth: '24rem',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '0.5rem',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    padding: '0.65rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.45rem',
    zIndex: 120,
  };
}

const triggerIconShellStyle: React.CSSProperties = {
  width: '1.55rem',
  height: '1.55rem',
  borderRadius: '999px',
  overflow: 'hidden',
  border: '1px solid rgba(56, 189, 248, 0.36)',
  background: '#ffffff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const triggerIconImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const triggerLabelStyle: React.CSSProperties = {
  maxWidth: '10rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.78rem',
  fontWeight: 600,
};

const menuHeaderStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#0f172a',
  fontWeight: 700,
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.73rem',
  lineHeight: 1.5,
  color: '#4b5563',
};

const detailListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '0.35rem',
};

const detailRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '4.5rem 1fr',
  gap: '0.45rem',
  alignItems: 'start',
};

const detailKeyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#6b7280',
};

const detailValueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#0f172a',
  wordBreak: 'break-all',
};

const chartValueStyle: React.CSSProperties = {
  margin: 0,
  minWidth: 0,
};

const sparklineWrapStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.15rem',
};

const sparklineSvgStyle: React.CSSProperties = {
  width: '100%',
  height: '3.5rem',
  display: 'block',
};

const sparklineLabelStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  color: '#64748b',
  fontSize: '0.68rem',
  lineHeight: 1.2,
};

const refreshButtonStyle: React.CSSProperties = {
  border: '1px solid #d5dee9',
  borderRadius: '0.45rem',
  background: '#f8fafc',
  color: '#0f172a',
  fontSize: '0.74rem',
  padding: '0.3rem 0.5rem',
  cursor: 'pointer',
  alignSelf: 'flex-end',
};
