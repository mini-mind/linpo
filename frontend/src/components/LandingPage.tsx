import type React from 'react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';

type IconName = 'image' | 'kanban' | 'flow' | 'approval' | 'artifact' | 'event' | 'spark';

type ImageSlotProps = {
  title: string;
  note: string;
  ratio: string;
  minHeight: number;
  icon?: IconName;
};

export function LandingPage(): JSX.Element {
  const isMobile = useIsMobile(960);

  return (
    <section style={pageStyle} aria-label="landing-page">
      <div style={orbOneStyle} aria-hidden />
      <div style={orbTwoStyle} aria-hidden />
      <div style={orbThreeStyle} aria-hidden />

      <div style={containerStyle}>
        <header style={navStyle}>
          <Link to="/landing" style={brandStyle} aria-label="灵盘首页">
            <img src="/assets/brand/linpo-flame-icon.svg" alt="" aria-hidden="true" style={brandIconStyle} />
            <span style={brandTextStyle}>灵盘</span>
          </Link>
          <div style={navActionStyle}>
            <Link to="/flow/edit/new" style={ghostButtonStyle}>
              创建流程
            </Link>
            <Link to="/kanban" style={solidButtonStyle}>
              进入看板
            </Link>
          </div>
        </header>

        <section style={heroStyle}>
          <div style={heroCopyStyle}>
            <p style={kickerStyle}>OpenClaw 协作编排层</p>
            <h1 style={titleStyle}>把复杂协作放进一张看板</h1>
            <p style={subtitleStyle}>一句话输入，流程生成，并行推进，统一审批，结果回看。</p>
            <div style={heroChipRowStyle}>
              <span style={heroChipStyle}>
                <SvgIcon name="kanban" size={14} color="#155e75" />
                看板推进
              </span>
              <span style={heroChipStyle}>
                <SvgIcon name="flow" size={14} color="#155e75" />
                流程编排
              </span>
              <span style={heroChipStyle}>
                <SvgIcon name="approval" size={14} color="#155e75" />
                统一审批
              </span>
            </div>
          </div>

          <div style={heroVisualStyle}>
            <ImageSlot title="主视觉占位" note="建议比例 16:10" ratio="16 / 10" minHeight={isMobile ? 220 : 420} />
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>产品界面预览</h2>
            <p style={sectionSubtitleStyle}>以真实截图尺寸预留，后续替换不偏版。</p>
          </div>

          <ImageSlot title="看板全景" note="建议比例 16:10（桌面主截图）" ratio="16 / 10" minHeight={isMobile ? 220 : 500} icon="kanban" />
        </section>

        <section style={sectionStyle}>
          <div style={splitHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>关键流程页面</h2>
              <p style={sectionSubtitleStyle}>极简文案，突出画面本身。</p>
            </div>
            <div style={stepRailStyle}>
              <StepDot text="需求" />
              <StepDot text="流程" />
              <StepDot text="执行" />
              <StepDot text="审批" />
              <StepDot text="产出" />
            </div>
          </div>

          <div style={dualVisualStyle}>
            <ImageSlot title="流程页" note="建议比例 4:3" ratio="4 / 3" minHeight={isMobile ? 220 : 380} icon="flow" />
            <ImageSlot title="产出页" note="建议比例 4:3" ratio="4 / 3" minHeight={isMobile ? 220 : 380} icon="artifact" />
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>补充素材位</h2>
            <p style={sectionSubtitleStyle}>用于审批、事件流、文件预览等营销图。</p>
          </div>
          <div style={tripleVisualStyle}>
            <ImageSlot title="审批" note="建议比例 3:4" ratio="3 / 4" minHeight={isMobile ? 220 : 360} icon="approval" />
            <ImageSlot title="事件流" note="建议比例 3:4" ratio="3 / 4" minHeight={isMobile ? 220 : 360} icon="event" />
            <ImageSlot title="文件预览" note="建议比例 3:4" ratio="3 / 4" minHeight={isMobile ? 220 : 360} icon="artifact" />
          </div>
        </section>

        <footer style={footerStyle}>
          <p style={footerTextStyle}>灵盘让复杂任务进入同一条可视化执行路径。</p>
          <Link to="/kanban" style={footerButtonStyle}>
            立即开始
          </Link>
        </footer>
      </div>
    </section>
  );
}

function StepDot({ text }: { text: string }): JSX.Element {
  return (
    <span style={stepDotStyle}>
      <span style={stepDotPointStyle} aria-hidden />
      {text}
    </span>
  );
}

function ImageSlot({ title, note, ratio, minHeight, icon = 'image' }: ImageSlotProps): JSX.Element {
  return (
    <article
      style={{
        ...imageSlotStyle,
        aspectRatio: ratio,
        minHeight: `${minHeight}px`,
      }}
      aria-label={`${title}-placeholder`}
    >
      <SvgIcon name={icon} size={26} color="#0369a1" />
      <p style={slotTagStyle}>Image Placeholder</p>
      <p style={slotTitleStyle}>{title}</p>
      <p style={slotNoteStyle}>{note}</p>
    </article>
  );
}

function SvgIcon({ name, size = 16, color = '#0f766e' }: { name: IconName; size?: number; color?: string }): JSX.Element {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'kanban':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="6" height="16" rx="1.5" />
          <rect x="10.5" y="8" width="5.5" height="12" rx="1.5" />
          <rect x="17" y="6" width="4" height="14" rx="1.5" />
        </svg>
      );
    case 'flow':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="18" cy="6" r="2.2" />
          <circle cx="12" cy="18" r="2.2" />
          <path d="M8.2 6h7.6M7.7 7.3l3.1 8.2m5.5-8.2l-3.1 8.2" />
        </svg>
      );
    case 'approval':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 5-3.5 8.2-7 10-3.5-1.8-7-5-7-10V6l7-3z" />
          <path d="M8.4 12.2l2.2 2.2 4.8-4.8" />
        </svg>
      );
    case 'artifact':
      return (
        <svg {...common}>
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v5h5" />
          <path d="M10 13h6M10 17h6" />
        </svg>
      );
    case 'event':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3l1.8 4.4L18 9.2l-4.2 1.8L12 15l-1.8-4L6 9.2l4.2-1.8L12 3z" />
        </svg>
      );
    case 'image':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4.8 18l5.1-4.8 3.3 3.1 3.1-2.8 3.1 4.5" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}

const pageStyle: React.CSSProperties = {
  height: '100%',
  overflowX: 'hidden',
  overflowY: 'auto',
  position: 'relative',
  padding: '0 1rem 4rem',
  background:
    'radial-gradient(1000px 700px at 10% -10%, rgba(16, 185, 129, 0.26), transparent 65%), radial-gradient(900px 700px at 95% 0%, rgba(14, 165, 233, 0.24), transparent 62%), linear-gradient(180deg, #f0f8fa 0%, #eef6f2 52%, #f6f8ef 100%)',
};

const orbOneStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-18rem',
  left: '-16rem',
  width: '42rem',
  height: '42rem',
  borderRadius: '50%',
  background: 'rgba(16, 185, 129, 0.18)',
  filter: 'blur(62px)',
  pointerEvents: 'none',
};

const orbTwoStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-14rem',
  right: '-14rem',
  width: '40rem',
  height: '40rem',
  borderRadius: '50%',
  background: 'rgba(14, 165, 233, 0.18)',
  filter: 'blur(62px)',
  pointerEvents: 'none',
};

const orbThreeStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '-16rem',
  left: '20%',
  width: '36rem',
  height: '36rem',
  borderRadius: '50%',
  background: 'rgba(217, 119, 6, 0.11)',
  filter: 'blur(60px)',
  pointerEvents: 'none',
};

const containerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '1320px',
  margin: '0 auto',
  paddingTop: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '7rem',
  position: 'relative',
  zIndex: 1,
};

const navStyle: React.CSSProperties = {
  height: '56px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  border: '1px solid rgba(15, 23, 42, 0.08)',
  borderRadius: '999px',
  backdropFilter: 'blur(10px)',
  background: 'rgba(255, 255, 255, 0.35)',
  padding: '0 0.48rem 0 0.9rem',
  position: 'sticky',
  top: '0.6rem',
  zIndex: 10,
};

const brandStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.52rem',
  textDecoration: 'none',
  color: '#10212f',
};

const brandIconStyle: React.CSSProperties = {
  width: '2rem',
  height: '2rem',
  display: 'block',
  flexShrink: 0,
};

const brandTextStyle: React.CSSProperties = {
  fontSize: '0.9rem',
  fontWeight: 700,
};

const navActionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
};

const buttonBaseStyle: React.CSSProperties = {
  minHeight: '2.15rem',
  padding: '0.45rem 0.82rem',
  borderRadius: '999px',
  textDecoration: 'none',
  fontSize: '0.78rem',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const ghostButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  color: '#0f172a',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'rgba(255, 255, 255, 0.62)',
};

const solidButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  color: '#ffffff',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
};

const heroStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2rem',
  alignItems: 'center',
};

const heroCopyStyle: React.CSSProperties = {
  flex: '1 1 520px',
  minWidth: '280px',
};

const heroVisualStyle: React.CSSProperties = {
  flex: '1 1 620px',
  minWidth: '300px',
};

const kickerStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  fontWeight: 700,
  color: '#0f766e',
  letterSpacing: '0.04em',
};

const titleStyle: React.CSSProperties = {
  margin: '0.9rem 0 0',
  fontSize: 'clamp(2.3rem, 6vw, 4.9rem)',
  lineHeight: 1.02,
  color: '#10212f',
  letterSpacing: '-0.02em',
  maxWidth: '13ch',
};

const subtitleStyle: React.CSSProperties = {
  margin: '1rem 0 0',
  fontSize: 'clamp(1rem, 2vw, 1.24rem)',
  lineHeight: 1.7,
  color: '#475569',
  maxWidth: '26ch',
};

const heroChipRowStyle: React.CSSProperties = {
  marginTop: '1.3rem',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.48rem',
};

const heroChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.36)',
  background: 'rgba(255, 255, 255, 0.5)',
  padding: '0.18rem 0.56rem',
  fontSize: '0.76rem',
  color: '#334155',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.8rem',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const splitHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'clamp(1.4rem, 2.2vw, 2rem)',
  color: '#0f172a',
};

const sectionSubtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  color: '#64748b',
};

const stepRailStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem',
};

const stepDotStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.28rem',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.34)',
  background: 'rgba(255, 255, 255, 0.42)',
  padding: '0.17rem 0.52rem',
  fontSize: '0.74rem',
  color: '#334155',
};

const stepDotPointStyle: React.CSSProperties = {
  width: '0.36rem',
  height: '0.36rem',
  borderRadius: '999px',
  background: '#0f766e',
  display: 'inline-block',
};

const dualVisualStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '1.2rem',
};

const tripleVisualStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '1.2rem',
};

const imageSlotStyle: React.CSSProperties = {
  borderRadius: '1rem',
  border: '1px dashed rgba(14, 116, 144, 0.35)',
  background: 'linear-gradient(155deg, rgba(224, 242, 254, 0.5) 0%, rgba(240, 253, 250, 0.45) 100%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '1rem',
  gap: '0.34rem',
};

const slotTagStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#0369a1',
};

const slotTitleStyle: React.CSSProperties = {
  margin: '0.15rem 0 0',
  fontSize: '0.96rem',
  fontWeight: 700,
  color: '#0f172a',
};

const slotNoteStyle: React.CSSProperties = {
  margin: '0.2rem 0 0',
  fontSize: '0.8rem',
  color: '#475569',
};

const footerStyle: React.CSSProperties = {
  padding: '1.1rem 0 0',
  borderTop: '1px solid rgba(148, 163, 184, 0.25)',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
};

const footerTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  color: '#334155',
};

const footerButtonStyle: React.CSSProperties = {
  ...solidButtonStyle,
  minHeight: '2.35rem',
  padding: '0.5rem 0.95rem',
};
