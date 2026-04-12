import type React from 'react';
import {
  CONNECTOR_OFFSET,
  HEADER_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './flowPageStateUtils';

export const floatingPlannerShellStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '0.85rem',
  transform: 'translateX(-50%)',
  width: 'min(760px, calc(100% - 1.5rem))',
  pointerEvents: 'none',
  zIndex: 55,
};

export const floatingPlannerShellMobileStyle: React.CSSProperties = {
  ...floatingPlannerShellStyle,
  left: '0.5rem',
  right: '0.5rem',
  bottom: '0.5rem',
  width: 'auto',
  transform: 'none',
};

export const floatingPlannerCardStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  boxShadow: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  pointerEvents: 'auto',
  padding: 0,
  background: 'transparent',
};

export const floatingPlannerCardMobileStyle: React.CSSProperties = {
  gap: '0.38rem',
};

export const floatingPlannerCardCollapsedStyle: React.CSSProperties = {
  ...floatingPlannerCardStyle,
  gap: 0,
  padding: 0,
};

export const floatingPlannerCardCollapsedMobileStyle: React.CSSProperties = {
  gap: 0,
};

export const floatingPlannerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.28rem',
  flexShrink: 0,
};

export const floatingPlannerHeaderMobileStyle: React.CSSProperties = {
  gap: '0.4rem',
};

export const plannerHeaderActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
  minWidth: 0,
};

export const plannerToggleButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.42)',
  borderRadius: '999px',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#0f172a',
  padding: '0.22rem 0.58rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const plannerCollapsedSummaryButtonStyle: React.CSSProperties = {
  border: '1px dashed rgba(14, 116, 144, 0.28)',
  borderRadius: '0.58rem',
  background: 'rgba(255, 255, 255, 0.78)',
  color: '#0f172a',
  padding: '0.5rem 0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.18rem',
  textAlign: 'left',
  cursor: 'pointer',
};

export const plannerCollapsedSummaryLabelStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#0f766e',
};

export const plannerCollapsedSummaryTextStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  lineHeight: 1.45,
  color: '#334155',
};

export const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'rgba(255, 255, 255, 0.84)',
  color: '#0f172a',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.75rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const secondaryButtonMobileStyle: React.CSSProperties = {
  width: '100%',
};

export const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  border: '1px solid rgba(220, 38, 38, 0.34)',
  background: 'rgba(254, 242, 242, 0.92)',
  color: '#b91c1c',
};

export const flowDetailCardStyle: React.CSSProperties = {
  width: 'min(420px, calc(100vw - 2rem))',
  border: '1px solid rgba(148, 163, 184, 0.34)',
  borderRadius: '0.7rem',
  background: 'rgba(255, 255, 255, 0.95)',
  boxShadow: '0 20px 38px -30px rgba(15, 23, 42, 0.8)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

export const flowDetailCardMobileStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: 'calc(100dvh - 5rem)',
  overflowY: 'auto',
};

export const flowDetailTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const formFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

export const formLabelStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: '#334155',
  fontWeight: 600,
};

export const formInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.4rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.96)',
  color: '#0f172a',
};

export const formTextareaStyle: React.CSSProperties = {
  ...formInputStyle,
  minHeight: '110px',
  resize: 'vertical',
  lineHeight: 1.5,
};

export const formReadonlyTextStyle: React.CSSProperties = {
  ...formInputStyle,
  minHeight: '34px',
  display: 'inline-flex',
  alignItems: 'center',
  color: '#475569',
  background: 'rgba(248, 250, 252, 0.9)',
};

export const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.42rem',
};

export const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.45rem',
};

export const actionRowMobileStyle: React.CSSProperties = {
  flexDirection: 'column-reverse',
};

export const confirmOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 90,
  background: 'rgba(15, 23, 42, 0.28)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
};

export const confirmOverlayMobileStyle: React.CSSProperties = {
  alignItems: 'flex-start',
  overflowY: 'auto',
  padding: '0.75rem',
};

export const confirmCardStyle: React.CSSProperties = {
  width: 'min(440px, calc(100vw - 2rem))',
  borderRadius: '0.75rem',
  border: '1px solid rgba(148, 163, 184, 0.36)',
  background: 'rgba(255, 255, 255, 0.97)',
  boxShadow: '0 24px 48px -30px rgba(15, 23, 42, 0.85)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

export const confirmCardMobileStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: 'calc(100dvh - 1.5rem)',
  overflowY: 'auto',
};

export const modalCardStyle: React.CSSProperties = {
  ...confirmCardStyle,
  width: 'min(520px, calc(100vw - 2rem))',
};

export const confirmTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const confirmTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#334155',
  lineHeight: 1.5,
};

export const confirmWarningTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#92400e',
  background: 'rgba(254, 243, 199, 0.7)',
  border: '1px solid rgba(217, 119, 6, 0.25)',
  borderRadius: '0.5rem',
  padding: '0.45rem 0.55rem',
  lineHeight: 1.45,
};

export const plannerComposerCardStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(14, 116, 144, 0.28)',
  borderRadius: '0.7rem',
  background: 'rgba(248, 250, 252, 0.88)',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 22px 42px -34px rgba(15, 23, 42, 0.95)',
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  pointerEvents: 'auto',
};

export const plannerComposerCardMobileStyle: React.CSSProperties = {
  padding: '0.5rem',
};

export const plannerComposerTextareaStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  borderRadius: '0.55rem',
  padding: '0.52rem 0.62rem',
  fontSize: '0.8rem',
  lineHeight: 1.45,
  minHeight: '92px',
  resize: 'vertical',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#0f172a',
};

export const plannerComposerTextareaMobileStyle: React.CSSProperties = {
  minHeight: '76px',
};

export const plannerComposerInlineStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  width: '100%',
  flexShrink: 0,
};

export const plannerComposerTextareaInlineStyle: React.CSSProperties = {
  ...plannerComposerTextareaStyle,
  minHeight: '94px',
  borderRadius: '0.8rem',
  background: 'rgba(248, 250, 252, 0.76)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 22px 42px -34px rgba(15, 23, 42, 0.95)',
};

export const plannerComposerTextareaCollapsedStyle: React.CSSProperties = {
  ...plannerComposerTextareaInlineStyle,
  minHeight: '42px',
  maxHeight: '42px',
  resize: 'none',
  padding: '0.58rem 0.72rem',
  overflow: 'hidden',
  background: 'rgba(248, 250, 252, 0.5)',
};

export const plannerComposerFooterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.52rem',
};

export const plannerComposerFooterMobileStyle: React.CSSProperties = {
  gap: '0.42rem',
};

export const plannerComposerHintStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  fontSize: '0.68rem',
  fontWeight: 600,
  color: '#94a3b8',
  whiteSpace: 'nowrap',
};

export const plannerComposerHintMobileStyle: React.CSSProperties = {
  fontSize: '0.64rem',
  gap: '0.28rem',
};

export const plannerComposerHintDividerStyle: React.CSSProperties = {
  color: '#cbd5e1',
};

export const canvasViewportStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  width: '100%',
  height: '100%',
  overflow: 'auto',
  boxSizing: 'border-box',
  paddingBottom: '146px',
  background:
    'radial-gradient(circle at 30px 30px, rgba(15, 118, 110, 0.08) 1px, transparent 1px), radial-gradient(circle at 30px 30px, rgba(148, 163, 184, 0.07) 0.5px, transparent 0.5px), linear-gradient(160deg, rgba(255, 255, 255, 0.72), rgba(240, 253, 250, 0.6))',
  backgroundSize: '38px 38px, 19px 19px, cover',
};

export const canvasViewportMobileStyle: React.CSSProperties = {
  paddingBottom: '136px',
  WebkitOverflowScrolling: 'touch',
};

export const canvasSurfaceStyle: React.CSSProperties = {
  position: 'relative',
  minWidth: '100%',
  minHeight: '100%',
};

export const stickyHeaderStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  height: `${HEADER_HEIGHT}px`,
  zIndex: 40,
  background: 'rgba(248, 250, 252, 0.9)',
  borderBottom: '1px solid rgba(148, 163, 184, 0.32)',
};

export const laneHeaderCellStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  height: `${HEADER_HEIGHT}px`,
  border: 'none',
  borderRight: '1px solid rgba(148, 163, 184, 0.24)',
  borderLeft: '1px solid rgba(148, 163, 184, 0.14)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(241,245,249,0.9))',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'flex-start',
  padding: '0.35rem 0.58rem',
  cursor: 'pointer',
  gap: '0.16rem',
};

export const laneHeaderNameStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#0f172a',
  fontWeight: 700,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  width: '100%',
  textAlign: 'left',
};

export const laneHeaderAgentStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  color: '#475569',
  fontWeight: 600,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  width: '100%',
  textAlign: 'left',
};

export const laneHeaderHintStyle: React.CSSProperties = {
  margin: 0,
  position: 'absolute',
  right: '1rem',
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: '0.72rem',
  color: '#64748b',
  pointerEvents: 'none',
};

export const laneBodyStyle: React.CSSProperties = {
  position: 'relative',
  top: 0,
};

export const laneColumnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  borderRight: '1px solid rgba(148, 163, 184, 0.18)',
  borderLeft: '1px solid rgba(148, 163, 184, 0.12)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(236,253,245,0.42))',
};

export const edgeSvgStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 6,
  pointerEvents: 'auto',
};

export const edgePathStyle: React.CSSProperties = {
  stroke: 'rgba(14, 116, 144, 0.5)',
  strokeWidth: 2,
  strokeDasharray: '8 8',
  strokeDashoffset: 0,
  animation: 'flowEdgeDash 1.2s linear infinite',
  fill: 'none',
  pointerEvents: 'none',
};

export const edgePathSelectedStyle: React.CSSProperties = {
  ...edgePathStyle,
  stroke: 'rgba(2, 132, 199, 0.92)',
  strokeWidth: 2.4,
  animation: 'flowEdgeDash 0.9s linear infinite',
};

export const edgeHitPathStyle: React.CSSProperties = {
  stroke: 'rgba(2, 132, 199, 0)',
  strokeWidth: 14,
  fill: 'none',
  pointerEvents: 'stroke',
};

export const edgePreviewPathStyle: React.CSSProperties = {
  stroke: 'rgba(14, 116, 144, 0.9)',
  strokeWidth: 2,
  strokeDasharray: '6 5',
  fill: 'none',
  pointerEvents: 'none',
};

export const flowCanvasAnimationStyleText = `
@keyframes flowEdgeDash {
  to {
    stroke-dashoffset: -16;
  }
}
`;

export const flowNodeCardStyle: React.CSSProperties = {
  position: 'absolute',
  width: `${NODE_WIDTH}px`,
  height: `${NODE_HEIGHT}px`,
  boxSizing: 'border-box',
  border: '1px solid rgba(15, 118, 110, 0.3)',
  borderRadius: '0.65rem',
  padding: '0.56rem',
  boxShadow: '0 10px 30px -24px rgba(15, 23, 42, 0.7)',
  background: 'linear-gradient(160deg, rgba(240, 253, 250, 0.93), rgba(236, 253, 245, 0.9))',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  cursor: 'pointer',
  zIndex: 10,
  userSelect: 'none',
  touchAction: 'none',
};

export const nodeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.3rem',
};

export const nodeStatusStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  color: '#334155',
  fontWeight: 700,
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.38)',
  padding: '0.05rem 0.42rem',
  background: 'rgba(255, 255, 255, 0.86)',
};

export const nodeLaneStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  color: '#0f766e',
  fontWeight: 700,
};

export const nodeTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  fontWeight: 700,
  color: '#0f172a',
  lineHeight: 1.3,
  wordBreak: 'break-word',
};

export const nodeDescriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  color: '#334155',
  lineHeight: 1.45,
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

export const nodeMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.68rem',
  color: '#64748b',
};

export const connectorStyle: React.CSSProperties = {
  position: 'absolute',
  width: '14px',
  height: '14px',
  boxSizing: 'border-box',
  borderRadius: '999px',
  border: '2px solid rgba(2, 132, 199, 0.95)',
  background: 'radial-gradient(circle at 45% 45%, #ffffff 0%, #e0f2fe 55%, #38bdf8 100%)',
  boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.9), 0 0 10px rgba(14, 116, 144, 0.45)',
  padding: 0,
  cursor: 'crosshair',
  zIndex: 18,
  touchAction: 'none',
};

export const connectorTopStyle: React.CSSProperties = {
  left: '50%',
  top: `${-CONNECTOR_OFFSET}px`,
  transform: 'translateX(-50%)',
};

export const connectorRightStyle: React.CSSProperties = {
  right: `${-CONNECTOR_OFFSET}px`,
  top: '50%',
  transform: 'translateY(-50%)',
};

export const connectorBottomStyle: React.CSSProperties = {
  left: '50%',
  bottom: `${-CONNECTOR_OFFSET}px`,
  transform: 'translateX(-50%)',
};

export const connectorLeftStyle: React.CSSProperties = {
  left: `${-CONNECTOR_OFFSET}px`,
  top: '50%',
  transform: 'translateY(-50%)',
};

export const emptyCanvasHintStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
};

export const emptyCanvasTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  color: '#64748b',
  background: 'rgba(255, 255, 255, 0.8)',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.6rem',
  padding: '0.42rem 0.68rem',
};
