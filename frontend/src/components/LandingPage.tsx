import type React from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';

type StageItem = {
  title: string;
  description: string;
  imageSrc: string;
};

const featureItems = [
  {
    icon: '⚙',
    title: '流程编排',
    description: '把自然语言需求拆成可执行节点，明确依赖关系与责任归属。',
  },
  {
    icon: '▶',
    title: '执行推进',
    description: '看板实时反映任务状态，关键动作和阻塞点持续回流可见。',
  },
  {
    icon: '⌁',
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

const heroBannerSlides = [
  { src: '/assets/landing/kanban-preview.svg', label: '看板总览' },
  { src: '/assets/landing/flow-preview.svg', label: '流程编排' },
  { src: '/assets/landing/summary-preview.svg', label: '摘要洞察' },
  { src: '/assets/landing/files-preview.svg', label: '文件协作' },
];

export function LandingPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const [bannerIndex, setBannerIndex] = useState(0);
  const resolvedFeaturesStyle = {
    ...featuresStyle,
    ...(isMobile ? featuresMobileStyle : null),
  };
  const resolvedHeroImageFrameStyle = {
    ...heroImageFrameStyle,
    ...(isMobile ? heroImageFrameMobileStyle : null),
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBannerIndex((current) => (current + 1) % heroBannerSlides.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, []);

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

        <section style={heroBandStyle}>
          <div style={{ ...heroBandInnerStyle, ...(isMobile ? heroBandInnerMobileStyle : null) }}>
            <div style={heroContentStyle}>
              <p style={heroKickerStyle}>OpenClaw 协作编排层</p>
              <h1 style={heroTitleStyle}>复杂协作一条路径执行到底</h1>
              <p style={heroDescStyle}>需求、执行、审批在同一画布闭环。</p>
              <Link to="/kanban" style={heroActionStyle}>
                立即体验
              </Link>
            </div>
            <div style={resolvedHeroImageFrameStyle}>
              <img
                src={heroBannerSlides[bannerIndex]?.src ?? heroBannerSlides[0].src}
                alt={heroBannerSlides[bannerIndex]?.label ?? '产品预览'}
                style={heroImageStyle}
                loading="eager"
              />
              <div style={heroBannerMetaStyle}>
                <span style={heroBannerTagStyle}>{heroBannerSlides[bannerIndex]?.label ?? '产品预览'}</span>
                <div style={heroBannerDotsStyle}>
                  {heroBannerSlides.map((slide, index) => (
                    <span
                      key={slide.src}
                      style={{
                        ...heroBannerDotStyle,
                        ...(index === bannerIndex ? heroBannerDotActiveStyle : null),
                      }}
                      aria-hidden
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section style={resolvedFeaturesStyle}>
          {featureItems.map((feature, index) => (
            <article
              key={feature.title}
              style={{
                ...featureRowStyle,
                ...(!isMobile
                  ? {
                      marginLeft: `${index * 64}px`,
                      maxWidth: `${780 - (featureItems.length - 1 - index) * 36}px`,
                    }
                  : null),
              }}
            >
              <span style={featureOrderStyle} aria-hidden>
                {index + 1}
              </span>
              <div style={featureCardStyle}>
                <p style={featureTitleStyle}>
                  <span style={featureIconStyle} aria-hidden>
                    {feature.icon}
                  </span>
                  {feature.title}
                </p>
                <p style={featureDescStyle}>{feature.description}</p>
              </div>
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

const heroBandStyle: React.CSSProperties = {
  width: '100vw',
  marginLeft: 'calc(50% - 50vw)',
  marginTop: '0.7rem',
  padding: '1.2rem 1rem 1.35rem',
  background: 'linear-gradient(180deg, rgba(236, 253, 245, 0.72) 0%, rgba(239, 246, 255, 0.7) 100%)',
  borderTop: '1px solid rgba(148, 163, 184, 0.2)',
  borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
};

const heroBandInnerStyle: React.CSSProperties = {
  maxWidth: '1200px',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '3.2rem',
};

const heroBandInnerMobileStyle: React.CSSProperties = {
  flexDirection: 'column',
  gap: '1.25rem',
};

const heroContentStyle: React.CSSProperties = {
  flex: '1 1 52%',
  maxWidth: '620px',
  paddingTop: '0.6rem',
};

const heroKickerStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.7rem',
  letterSpacing: '0.06em',
  fontWeight: 700,
  color: '#0f766e',
};

const heroTitleStyle: React.CSSProperties = {
  margin: '1rem 0 0',
  fontSize: 'clamp(2.2rem, 4.8vw, 3.9rem)',
  lineHeight: 1.04,
  letterSpacing: '-0.03em',
  color: '#0f172a',
  maxWidth: '12ch',
};

const heroDescStyle: React.CSSProperties = {
  margin: '1.1rem 0 0',
  fontSize: '0.92rem',
  lineHeight: 1.55,
  color: '#475569',
  maxWidth: '24ch',
};

const heroActionStyle: React.CSSProperties = {
  ...solidButtonStyle,
  marginTop: '1.45rem',
  minHeight: '2.15rem',
  padding: '0.42rem 0.82rem',
  fontSize: '0.76rem',
};

const heroImageFrameStyle: React.CSSProperties = {
  flex: '1 1 54%',
  borderRadius: '1.25rem',
  overflow: 'hidden',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  boxShadow: '0 26px 56px -36px rgba(15, 23, 42, 0.5)',
  background: 'rgba(255, 255, 255, 0.7)',
  minHeight: '460px',
  position: 'relative',
};

const heroImageFrameMobileStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '240px',
  maxHeight: '280px',
};

const heroImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const heroBannerMetaStyle: React.CSSProperties = {
  position: 'absolute',
  left: '0.85rem',
  right: '0.85rem',
  bottom: '0.85rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
};

const heroBannerTagStyle: React.CSSProperties = {
  borderRadius: '999px',
  background: 'rgba(15, 23, 42, 0.55)',
  color: '#f8fafc',
  fontSize: '0.74rem',
  fontWeight: 700,
  letterSpacing: '0.05em',
  padding: '0.24rem 0.6rem',
};

const heroBannerDotsStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.24rem 0.35rem',
  borderRadius: '999px',
  background: 'rgba(15, 23, 42, 0.5)',
};

const heroBannerDotStyle: React.CSSProperties = {
  width: '0.4rem',
  height: '0.4rem',
  borderRadius: '999px',
  background: 'rgba(203, 213, 225, 0.7)',
};

const heroBannerDotActiveStyle: React.CSSProperties = {
  width: '0.85rem',
  background: '#2dd4bf',
};

const featuresStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
  alignItems: 'flex-start',
};

const featuresMobileStyle: React.CSSProperties = {
  gap: '0.7rem',
};

const featureRowStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'stretch',
  gap: '0.6rem',
};

const featureCardStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: '1rem',
  borderTop: '1px solid rgba(148, 163, 184, 0.24)',
  borderBottom: '1px solid rgba(148, 163, 184, 0.24)',
  borderLeft: '1px solid rgba(148, 163, 184, 0.24)',
  borderRight: '1px solid rgba(148, 163, 184, 0.06)',
  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.92) 0%, rgba(255, 255, 255, 0.84) 46%, rgba(255, 255, 255, 0) 100%)',
  boxShadow: '0 12px 28px -22px rgba(15, 23, 42, 0.35)',
  padding: '0.88rem 1rem',
};

const featureTitleStyle: React.CSSProperties = {
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '0.42rem',
  fontSize: '1.26rem',
  fontWeight: 700,
  color: '#0f172a',
};

const featureIconStyle: React.CSSProperties = {
  width: '1.4rem',
  height: '1.4rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#0b3a53',
  fontSize: '1.18rem',
  fontWeight: 700,
  lineHeight: 1,
};

const featureOrderStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '3rem',
  padding: '0 0.35rem',
  borderRadius: '0.9rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'linear-gradient(180deg, rgba(236, 253, 245, 0.72) 0%, rgba(219, 234, 254, 0.7) 100%)',
  fontSize: '2.1rem',
  fontWeight: 800,
  fontStyle: 'italic',
  letterSpacing: '0.01em',
  color: '#0b3a53',
  textShadow: '0 1px 0 #ffffff, 0 6px 16px rgba(15, 23, 42, 0.12)',
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

const stepTitleStyle: React.CSSProperties = {
  margin: '0.1rem 0 0',
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
