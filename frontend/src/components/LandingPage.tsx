import type React from 'react';
import { Link } from 'react-router-dom';

export function LandingPage(): JSX.Element {
  return (
    <section style={pageStyle} aria-label="landing-page">
      <div style={glowOneStyle} aria-hidden />
      <div style={glowTwoStyle} aria-hidden />

      <div style={cardStyle}>
        <p style={badgeStyle}>Linpo v0.7 人机协作中枢</p>
        <h1 style={titleStyle}>让需求从一句话开始，稳定落到可执行看板</h1>
        <p style={subtitleStyle}>
          连接 OpenClaw 与团队协作流程，自动拆分任务、可视化依赖、统一审批入口，让复杂交付更快闭环。
        </p>

        <div style={ctaRowStyle}>
          <Link to="/kanban" style={primaryCtaStyle}>
            立即进入看板
          </Link>
          <Link to="/flow" style={secondaryCtaStyle}>
            先创建流程
          </Link>
        </div>
      </div>
    </section>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2rem 1rem',
  background:
    'radial-gradient(circle at 15% 20%, rgba(234, 179, 8, 0.2) 0%, transparent 45%), radial-gradient(circle at 85% 80%, rgba(16, 185, 129, 0.2) 0%, transparent 42%), linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #334155 100%)',
  position: 'relative',
  overflow: 'hidden',
};

const glowOneStyle: React.CSSProperties = {
  position: 'absolute',
  width: '28rem',
  height: '28rem',
  borderRadius: '999px',
  background: 'rgba(56, 189, 248, 0.12)',
  filter: 'blur(28px)',
  top: '-8rem',
  left: '-6rem',
  pointerEvents: 'none',
};

const glowTwoStyle: React.CSSProperties = {
  position: 'absolute',
  width: '24rem',
  height: '24rem',
  borderRadius: '999px',
  background: 'rgba(251, 146, 60, 0.14)',
  filter: 'blur(26px)',
  bottom: '-7rem',
  right: '-5rem',
  pointerEvents: 'none',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '760px',
  borderRadius: '1.25rem',
  padding: '2.5rem 2rem',
  background: 'rgba(15, 23, 42, 0.72)',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 30px 70px rgba(2, 6, 23, 0.4)',
  color: '#e2e8f0',
  position: 'relative',
  zIndex: 1,
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  margin: 0,
  marginBottom: '1rem',
  padding: '0.35rem 0.75rem',
  borderRadius: '999px',
  fontSize: '0.78rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  color: '#fbbf24',
  background: 'rgba(251, 191, 36, 0.13)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'clamp(1.85rem, 4vw, 2.7rem)',
  lineHeight: 1.2,
  color: '#f8fafc',
};

const subtitleStyle: React.CSSProperties = {
  margin: '1rem 0 0',
  maxWidth: '40rem',
  fontSize: '1.03rem',
  lineHeight: 1.7,
  color: 'rgba(226, 232, 240, 0.9)',
};

const ctaRowStyle: React.CSSProperties = {
  marginTop: '1.75rem',
  display: 'flex',
  gap: '0.85rem',
  flexWrap: 'wrap',
};

const ctaBaseStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.72rem 1.2rem',
  borderRadius: '0.72rem',
  fontSize: '0.95rem',
  fontWeight: 700,
  textDecoration: 'none',
  transition: 'transform 0.2s ease',
};

const primaryCtaStyle: React.CSSProperties = {
  ...ctaBaseStyle,
  color: '#052e2b',
  background: 'linear-gradient(120deg, #34d399 0%, #2dd4bf 100%)',
  boxShadow: '0 12px 24px rgba(20, 184, 166, 0.28)',
};

const secondaryCtaStyle: React.CSSProperties = {
  ...ctaBaseStyle,
  color: '#e2e8f0',
  background: 'rgba(15, 23, 42, 0.45)',
  border: '1px solid rgba(148, 163, 184, 0.45)',
};
