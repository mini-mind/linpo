import type React from 'react';
import { Link } from 'react-router-dom';

export function PairingTutorialPage(): JSX.Element {
  return (
    <section style={pageStyle} aria-label="pairing-tutorial-page">
      <header style={toolbarStyle} role="toolbar" aria-label="配对教程工具栏">
        <div>
          <h2 style={titleStyle}>配对教程</h2>
          <p style={subtitleStyle}>仅通过 OpenClaw 对话，也能在 3 分钟内接入 Linpo</p>
        </div>
        <Link to="/pairing" style={primaryLinkStyle}>
          去配对
        </Link>
      </header>

      <article style={cardStyle}>
        <ol style={stepsStyle}>
          <li style={stepStyle}>
            <h3 style={stepTitleStyle}>选择配对方式</h3>
            <p style={stepTextStyle}>支持 `Token 配对` 与 `配对码配对`，都在“实例”页新建配对区域完成。</p>
          </li>
          <li style={stepStyle}>
            <h3 style={stepTitleStyle}>Token 配对：获取 endpoint 与 token</h3>
            <p style={stepTextStyle}>让 OpenClaw 返回网关地址与 Gateway Token，例如 `http://127.0.0.1:28789`。</p>
          </li>
          <li style={stepStyle}>
            <h3 style={stepTitleStyle}>配对码配对：直接获取短码</h3>
            <p style={stepTextStyle}>让 OpenClaw 生成配对码（`LP1...` 或 `linpo://pair?code=...`），在实例页直接粘贴即可。</p>
          </li>
          <li style={stepStyle}>
            <h3 style={stepTitleStyle}>设为当前实例并开始使用</h3>
            <p style={stepTextStyle}>在实例列表中把 claw2 设为当前，之后看板、流程、会话请求都会自动带上该实例上下文。</p>
          </li>
        </ol>
      </article>
    </section>
  );
}

const pageStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};

const toolbarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 40,
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.44)',
  backdropFilter: 'blur(8px)',
  padding: '0.55rem 0.65rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#0f172a',
};

const subtitleStyle: React.CSSProperties = {
  margin: '0.18rem 0 0',
  fontSize: '0.76rem',
  color: '#475569',
};

const primaryLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  border: '1px solid rgba(14, 116, 144, 0.52)',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  borderRadius: '0.45rem',
  padding: '0.35rem 0.7rem',
  fontSize: '0.78rem',
  fontWeight: 700,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.34)',
  borderRadius: '0.75rem',
  background: 'rgba(255, 255, 255, 0.9)',
  boxShadow: '0 20px 40px -30px rgba(15, 23, 42, 0.8)',
  padding: '1rem',
};

const stepsStyle: React.CSSProperties = {
  margin: 0,
  paddingInlineStart: '1.1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.82rem',
};

const stepStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};

const stepTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  color: '#0f172a',
  fontWeight: 700,
};

const stepTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  lineHeight: 1.55,
  color: '#334155',
};
