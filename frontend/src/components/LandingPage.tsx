import type React from 'react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';

type StageItem = {
  title: string;
  description: string;
  imageSrc: string;
};

const featureItems = [
  {
    title: '流程编排',
    description: '把自然语言需求拆成可执行节点，明确依赖关系与责任归属。',
  },
  {
    title: '执行推进',
    description: '看板实时反映任务状态，关键动作和阻塞点持续回流可见。',
  },
  {
    title: '交付沉淀',
    description: '任务产出与 Agent 文档集中在实例文件页，便于复盘与复用。',
  },
];

const stageItems: StageItem[] = [
  {
    title: '看板推进',
    description: '从待处理到已完成，任务沿着统一状态流推进，协作路径一眼可见。',
    imageSrc: '/assets/landing/kanban-main.png',
  },
  {
    title: '流程设计',
    description: '流程编辑器承接需求拆解结果，节点结构可持续迭代。',
    imageSrc: '/assets/landing/flow-main.png',
  },
  {
    title: '摘要洞察',
    description: '关键事件、状态变化与执行风险汇聚到摘要视图。',
    imageSrc: '/assets/landing/summary-main.png',
  },
  {
    title: '文件归档',
    description: '输出文件和 Agent 文档按实例聚合，检索、预览、下载路径完整。',
    imageSrc: '/assets/landing/files-main.png',
  },
];

export function LandingPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const resolvedFeaturesStyle = {
    ...featuresStyle,
    ...(isMobile ? featuresMobileStyle : null),
  };

  return (
    <section style={pageStyle} aria-label="landing-page">
      <div style={bgGlowTopStyle} aria-hidden />
      <div style={bgGlowBottomStyle} aria-hidden />

      <div style={mainStyle}>
        <header style={navStyle}>
          <Link to="/landing" style={brandStyle} aria-label="灵盘首页">
            <img src="/assets/brand/linpo-flame-icon.svg" alt="" aria-hidden="true" style={brandIconStyle} />
            <span style={brandTextStyle}>灵盘 Linpo</span>
          </Link>
          <div style={navActionsStyle}>
            <Link to="/kanban" style={solidButtonStyle}>
              进入看板
            </Link>
          </div>
        </header>

        <section style={{ ...heroStyle, ...(isMobile ? heroMobileStyle : null) }}>
          <div style={heroContentStyle}>
            <p style={heroKickerStyle}>OpenClaw 协作编排层</p>
            <h1 style={heroTitleStyle}>把复杂协作发布成一条可执行路径</h1>
            <p style={heroDescStyle}>需求、执行、审批在同一画布闭环。</p>
            <Link to="/kanban" style={heroActionStyle}>
              立即体验
            </Link>
          </div>
          <div style={heroImageFrameStyle}>
            <img src="/assets/landing/kanban-main.png" alt="灵盘看板 PC 截图" style={heroImageStyle} loading="eager" />
          </div>
        </section>

        <section style={resolvedFeaturesStyle}>
          {featureItems.map((feature) => (
            <article key={feature.title} style={featureCardStyle}>
              <p style={featureTitleStyle}>{feature.title}</p>
              <p style={featureDescStyle}>{feature.description}</p>
            </article>
          ))}
        </section>

        <section style={stepsSectionStyle}>
          {stageItems.map((stage, index) => {
            const reverse = index % 2 === 1;
            return (
              <article
                key={stage.title}
                style={{
                  ...stepRowStyle,
                  ...(reverse && !isMobile ? stepRowReverseStyle : null),
                  ...(isMobile ? stepRowMobileStyle : null),
                }}
              >
                <div style={stepContentStyle}>
                  <p style={stepLabelStyle}>步骤 {index + 1}</p>
                  <h2 style={stepTitleStyle}>{stage.title}</h2>
                  <p style={stepDescStyle}>{stage.description}</p>
                </div>
                <div style={stepImageFrameStyle}>
                  <img src={stage.imageSrc} alt={stage.title} style={stepImageStyle} loading="lazy" />
                </div>
              </article>
            );
          })}
        </section>

        <section style={ctaWrapStyle}>
          <h2 style={ctaTitleStyle}>让下一次协作，从一开始就进入可执行状态</h2>
          <p style={ctaDescStyle}>灵盘把流程、执行、审批和产出收敛到一个连续工作流。</p>
          <div style={ctaButtonsStyle}>
            <Link to="/kanban" style={solidButtonStyle}>
              进入看板
            </Link>
          </div>
        </section>

        <footer style={footerStyle}>© {new Date().getFullYear()} 灵盘 Linpo</footer>
      </div>
    </section>
  );
}

const pageStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  overflowX: 'hidden',
  overflowY: 'auto',
  padding: '0 1rem 3rem',
  background:
    'linear-gradient(180deg, #eef8f8 0%, #f7fbfd 45%, #f8fafc 100%)',
};

const bgGlowTopStyle: React.CSSProperties = {
  position: 'fixed',
  top: '-8rem',
  right: '-8rem',
  width: '22rem',
  height: '22rem',
  borderRadius: '999px',
  pointerEvents: 'none',
  background: 'radial-gradient(circle, rgba(13, 148, 136, 0.2) 0%, rgba(13, 148, 136, 0) 70%)',
};

const bgGlowBottomStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '-8rem',
  left: '-8rem',
  width: '22rem',
  height: '22rem',
  borderRadius: '999px',
  pointerEvents: 'none',
  background: 'radial-gradient(circle, rgba(2, 132, 199, 0.18) 0%, rgba(2, 132, 199, 0) 70%)',
};

const mainStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  maxWidth: '1200px',
  margin: '0 auto',
  paddingTop: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '3rem',
};

const navStyle: React.CSSProperties = {
  position: 'sticky',
  top: '0.6rem',
  zIndex: 20,
  height: '56px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255, 255, 255, 0.72)',
  backdropFilter: 'blur(10px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 0.5rem 0 0.95rem',
};

const brandStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.52rem',
  textDecoration: 'none',
  color: '#0f172a',
};

const brandIconStyle: React.CSSProperties = {
  width: '2rem',
  height: '2rem',
  display: 'block',
};

const brandTextStyle: React.CSSProperties = {
  fontSize: '0.92rem',
  fontWeight: 700,
};

const navActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
};

const baseButtonStyle: React.CSSProperties = {
  minHeight: '2.2rem',
  borderRadius: '999px',
  padding: '0.45rem 0.88rem',
  textDecoration: 'none',
  fontSize: '0.8rem',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const solidButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  color: '#ffffff',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
};

const ghostButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  color: '#0f172a',
  border: '1px solid rgba(148, 163, 184, 0.34)',
  background: 'rgba(255, 255, 255, 0.8)',
};

const heroStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '2.5rem',
  marginTop: '0.8rem',
};

const heroMobileStyle: React.CSSProperties = {
  flexDirection: 'column',
  gap: '1.25rem',
};

const heroContentStyle: React.CSSProperties = {
  flex: '1 1 52%',
  maxWidth: '620px',
};

const heroKickerStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  letterSpacing: '0.06em',
  fontWeight: 700,
  color: '#0f766e',
};

const heroTitleStyle: React.CSSProperties = {
  margin: '0.8rem 0 0',
  fontSize: 'clamp(2.8rem, 6.6vw, 5.2rem)',
  lineHeight: 0.96,
  letterSpacing: '-0.03em',
  color: '#0f172a',
  maxWidth: '10.5ch',
};

const heroDescStyle: React.CSSProperties = {
  margin: '1rem 0 0',
  fontSize: '1.18rem',
  lineHeight: 1.65,
  color: '#334155',
  maxWidth: '24ch',
};

const heroActionStyle: React.CSSProperties = {
  ...solidButtonStyle,
  marginTop: '1.35rem',
  minHeight: '2.45rem',
  padding: '0.52rem 1rem',
};

const heroImageFrameStyle: React.CSSProperties = {
  flex: '1 1 48%',
  borderRadius: '1.25rem',
  overflow: 'hidden',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  boxShadow: '0 26px 56px -36px rgba(15, 23, 42, 0.5)',
  background: 'rgba(255, 255, 255, 0.7)',
  minHeight: '320px',
};

const heroImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const featuresStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '1rem',
};

const featuresMobileStyle: React.CSSProperties = {
  gridTemplateColumns: '1fr',
};

const featureCardStyle: React.CSSProperties = {
  borderRadius: '1rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255, 255, 255, 0.78)',
  boxShadow: '0 12px 28px -22px rgba(15, 23, 42, 0.35)',
  padding: '1rem',
};

const featureTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.26rem',
  fontWeight: 700,
  color: '#0f172a',
};

const featureDescStyle: React.CSSProperties = {
  margin: '0.55rem 0 0',
  fontSize: '0.98rem',
  lineHeight: 1.62,
  color: '#475569',
};

const stepsSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2rem',
  padding: '0.6rem 0',
};

const stepRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1.2rem',
  borderRadius: '1.1rem',
  padding: '1rem',
  background: 'linear-gradient(135deg, rgba(240, 253, 250, 0.78) 0%, rgba(239, 246, 255, 0.82) 100%)',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  boxShadow: '0 16px 34px -30px rgba(15, 23, 42, 0.38)',
};

const stepRowReverseStyle: React.CSSProperties = {
  flexDirection: 'row-reverse',
};

const stepRowMobileStyle: React.CSSProperties = {
  flexDirection: 'column',
  alignItems: 'stretch',
};

const stepContentStyle: React.CSSProperties = {
  flex: '1 1 48%',
  borderRadius: '0.9rem',
  padding: '0.35rem 0.25rem',
};

const stepLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: '#0f766e',
  textTransform: 'uppercase',
};

const stepTitleStyle: React.CSSProperties = {
  margin: '0.5rem 0 0',
  fontSize: 'clamp(2rem, 3.8vw, 3.1rem)',
  lineHeight: 1,
  color: '#0f172a',
  letterSpacing: '-0.02em',
};

const stepDescStyle: React.CSSProperties = {
  margin: '0.8rem 0 0',
  fontSize: '1.08rem',
  lineHeight: 1.7,
  color: '#334155',
};

const stepImageFrameStyle: React.CSSProperties = {
  flex: '1 1 52%',
  borderRadius: '1rem',
  overflow: 'hidden',
  minHeight: '240px',
  background: 'rgba(255, 255, 255, 0.5)',
};

const stepImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'cover',
};

const ctaWrapStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '2rem 0 0.8rem',
};

const ctaTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'clamp(2rem, 4vw, 3.3rem)',
  lineHeight: 1.05,
  color: '#0f172a',
  letterSpacing: '-0.02em',
};

const ctaDescStyle: React.CSSProperties = {
  margin: '0.9rem auto 0',
  maxWidth: '34ch',
  fontSize: '1.05rem',
  color: '#475569',
  lineHeight: 1.65,
};

const ctaButtonsStyle: React.CSSProperties = {
  marginTop: '1.35rem',
  display: 'flex',
  justifyContent: 'center',
  gap: '0.65rem',
  flexWrap: 'wrap',
};

const footerStyle: React.CSSProperties = {
  textAlign: 'center',
  color: '#64748b',
  fontSize: '0.9rem',
  padding: '0.3rem 0 0.8rem',
};
