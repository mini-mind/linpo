import type React from 'react';
import {
  CONNECTOR_OFFSET,
  HEADER_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './flowPageStateUtils';
import {
  getWorkspaceDesktopTwoColumnMainStyle,
  getWorkspaceDesktopTwoColumnShellStyle,
} from './workspaceLayout';

export const pageStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

export const topToolbarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 60,
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.44)',
  backdropFilter: 'blur(8px)',
  padding: '0.55rem 0.95rem',
  display: 'block',
  flexShrink: 0,
};

export const topToolbarMobileStyle: React.CSSProperties = {
  padding: '0.45rem 0.5rem',
  gap: '0.45rem',
};

export const toolbarInnerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
  flexWrap: 'wrap',
};

export const toolbarInnerMobileStyle: React.CSSProperties = {
  ...toolbarInnerStyle,
  gap: '0.45rem',
};

export const toolbarLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.42rem',
  minWidth: 0,
};

export const toolbarLeftMobileStyle: React.CSSProperties = {
  width: '100%',
};

export const toolbarRightStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.45rem',
  flexWrap: 'wrap',
  flexShrink: 0,
};

export const toolbarRightMobileStyle: React.CSSProperties = {
  width: '100%',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  flexDirection: 'column',
};

export const breadcrumbRootButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#0f172a',
  fontSize: '0.82rem',
  fontWeight: 700,
  padding: 0,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const breadcrumbSeparatorStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#64748b',
  fontWeight: 600,
};

export const breadcrumbCurrentButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#0f766e',
  fontSize: '0.82rem',
  fontWeight: 700,
  padding: 0,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '280px',
};

export const breadcrumbCurrentButtonMobileStyle: React.CSSProperties = {
  maxWidth: '58vw',
};

export const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.52)',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.75rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const primaryButtonMobileStyle: React.CSSProperties = {
  width: '100%',
};

export const flowStopButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  border: '1px solid rgba(220, 38, 38, 0.46)',
  background: 'linear-gradient(120deg, #b91c1c 0%, #dc2626 100%)',
};

export const flowContinueButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  border: '1px solid rgba(180, 83, 9, 0.46)',
  background: 'linear-gradient(120deg, #b45309 0%, #d97706 100%)',
};

export const flowWorkspaceStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '280px minmax(0, 1fr)',
  gap: '0.75rem',
  padding: '0 0.85rem 0.85rem',
};

export const flowWorkspaceMobileStyle: React.CSSProperties = {
  ...flowWorkspaceStyle,
  gridTemplateColumns: '1fr',
  gridTemplateRows: 'minmax(0, 1fr)',
  padding: '0 0.5rem 0.5rem',
};

// 复用工作区双栏基础壳，确保 Flow 与 Collab 等页面共享同一套“无留白”布局基线。
export const flowDesktopShellStyle: React.CSSProperties = getWorkspaceDesktopTwoColumnShellStyle({
  sidebarWidthPx: 280,
  // Flow 桌面态沿用既有视觉：双栏贴合且裁剪溢出，避免出现多余滚动留白。
  extra: {
    gap: 0,
    overflow: 'hidden',
  },
});

// 主区域使用共享基础样式，Flow 只做显式保留，不在这里引入额外内边距。
export const flowDesktopCanvasWrapStyle: React.CSSProperties = getWorkspaceDesktopTwoColumnMainStyle({
  extra: {
    padding: 0,
  },
});

export const flowSidebarStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.72rem',
  background: 'rgba(248, 250, 252, 0.78)',
  padding: '0.75rem 0.7rem 0.7rem 0.95rem',
  overflow: 'hidden',
};

export const flowSidebarMobileStyle: React.CSSProperties = {
  ...flowSidebarStyle,
  padding: '0.55rem',
};

export const flowSidebarDesktopStyle: React.CSSProperties = {
  ...flowSidebarStyle,
  borderRadius: 0,
  borderTop: 'none',
  borderBottom: 'none',
  borderLeft: 'none',
  padding: '0.8rem 0.72rem 0.72rem 0.96rem',
  background: 'rgba(248, 250, 252, 0.96)',
  boxShadow: '14px 0 32px -32px rgba(15, 23, 42, 0.9)',
};

export const flowSidebarDrawerOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 75,
  background: 'rgba(15, 23, 42, 0.3)',
  display: 'flex',
  justifyContent: 'flex-start',
};

export const flowSidebarDrawerStyle: React.CSSProperties = {
  ...flowSidebarMobileStyle,
  width: 'min(286px, calc(100vw - 1.2rem))',
  height: '100%',
  borderRadius: 0,
  borderTop: 'none',
  borderBottom: 'none',
  borderLeft: 'none',
  background: 'rgba(248, 250, 252, 0.98)',
  boxShadow: '18px 0 42px -34px rgba(15, 23, 42, 0.9)',
};

export const flowSidebarHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  flexShrink: 0,
};

export const flowSidebarHeaderDrawerStyle: React.CSSProperties = {
  gap: '0.26rem',
};

export const flowSidebarHeaderTopRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.44rem',
};

export const flowSidebarTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const flowSidebarTitleDrawerStyle: React.CSSProperties = {
  fontSize: '0.84rem',
};

export const flowSidebarHeaderActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.36rem',
};

export const flowSidebarHeaderActionsDrawerStyle: React.CSSProperties = {
  gap: '0.34rem',
};

export const sidebarGhostButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.38)',
  borderRadius: '0.42rem',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#334155',
  padding: '0.3rem 0.56rem',
  fontSize: '0.74rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const sidebarPrimaryButtonStyle: React.CSSProperties = {
  ...sidebarGhostButtonStyle,
  border: '1px solid rgba(14, 116, 144, 0.42)',
  background: 'rgba(239, 246, 255, 0.92)',
  color: '#0f766e',
};

export const sidebarButtonDrawerStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.34rem 0.46rem',
  fontSize: '0.72rem',
  borderRadius: '0.4rem',
};

export const flowSidebarListStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
  paddingRight: '0.08rem',
};

export const flowSidebarListDrawerStyle: React.CSSProperties = {
  gap: '0.32rem',
  paddingRight: '0.02rem',
};

export const flowSidebarSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.34rem',
};

export const flowSidebarSectionDrawerStyle: React.CSSProperties = {
  gap: '0.24rem',
};

export const flowSidebarSectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
};

export const flowSidebarSectionTitleStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#334155',
  letterSpacing: '0.02em',
};

export const flowSidebarSectionTitleDrawerStyle: React.CSSProperties = {
  fontSize: '0.66rem',
};

export const flowSidebarSectionCountStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  color: '#64748b',
  fontWeight: 700,
};

export const flowSidebarSectionCountDrawerStyle: React.CSSProperties = {
  fontSize: '0.62rem',
};

export const flowSidebarSectionListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.34rem',
};

export const flowSidebarItemCardStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

export const flowSidebarItemCardDrawerStyle: React.CSSProperties = {
  gap: '0.24rem',
};

export const flowSidebarEmptyStyle: React.CSSProperties = {
  border: '1px dashed rgba(148, 163, 184, 0.32)',
  borderRadius: '0.55rem',
  background: 'rgba(255, 255, 255, 0.72)',
  padding: '0.62rem',
  fontSize: '0.76rem',
  color: '#64748b',
  lineHeight: 1.5,
};

export const flowSidebarEmptyDrawerStyle: React.CSSProperties = {
  padding: '0.5rem',
  fontSize: '0.72rem',
  borderRadius: '0.45rem',
  lineHeight: 1.4,
};

export const flowSidebarItemStyle: React.CSSProperties = {
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(148, 163, 184, 0.22)',
  borderRadius: '0.55rem',
  background: 'rgba(255, 255, 255, 0.82)',
  padding: '0.55rem 0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.22rem',
  textAlign: 'left',
  cursor: 'pointer',
};

export const flowSidebarItemDrawerStyle: React.CSSProperties = {
  padding: '0.42rem 0.46rem',
  gap: '0.16rem',
  borderRadius: '0.46rem',
};

export const flowSidebarItemActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(14, 116, 144, 0.42)',
  background: 'rgba(239, 246, 255, 0.92)',
};

export const flowSidebarItemBodyButtonStyle: React.CSSProperties = {
  paddingRight: '4.3rem',
};

export const flowSidebarItemBodyButtonDrawerStyle: React.CSSProperties = {
  paddingRight: '4.05rem',
};

export const flowSidebarItemTitleStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#0f172a',
  lineHeight: 1.4,
};

export const flowSidebarItemTitleDrawerStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  lineHeight: 1.3,
};

export const flowSidebarItemMetaStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#52616f',
  lineHeight: 1.45,
};

export const flowSidebarItemMetaDrawerStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  lineHeight: 1.35,
};

export const flowSidebarDraftSyncErrorStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#b42318',
  lineHeight: 1.45,
  fontWeight: 700,
};

export const flowSidebarDraftSyncErrorDrawerStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  lineHeight: 1.35,
  color: '#b42318',
  fontWeight: 700,
};

export const flowSidebarItemEditButtonStyle: React.CSSProperties = {
  position: 'absolute',
  right: '0.58rem',
  top: '0.55rem',
  minWidth: '3rem',
  border: '1px solid rgba(148, 163, 184, 0.34)',
  borderRadius: '0.5rem',
  background: 'rgba(255, 255, 255, 0.88)',
  color: '#334155',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
  padding: '0.26rem 0.44rem',
};

export const flowSidebarItemEditButtonDrawerStyle: React.CSSProperties = {
  right: '0.46rem',
  top: '0.42rem',
  minWidth: '2.84rem',
  fontSize: '0.68rem',
  borderRadius: '0.42rem',
};

export const flowSidebarItemRunButtonStyle: React.CSSProperties = {
  position: 'absolute',
  right: '0.58rem',
  top: '2.4rem',
  minWidth: '3rem',
  border: '1px solid rgba(14, 116, 144, 0.42)',
  borderRadius: '0.5rem',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
  padding: '0.26rem 0.44rem',
  boxShadow: '0 12px 24px -24px rgba(15, 23, 42, 0.9)',
};

export const flowSidebarItemRunButtonDrawerStyle: React.CSSProperties = {
  right: '0.46rem',
  top: '2.08rem',
  minWidth: '2.84rem',
  fontSize: '0.68rem',
  borderRadius: '0.42rem',
};

export const plannerRailTitleWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.16rem',
};

export const plannerRailTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const plannerRailHintTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
  lineHeight: 1.45,
};

export const plannerRailMetaStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  color: '#64748b',
  fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const floatingPlannerMessagesStyle: React.CSSProperties = {
  maxHeight: 'min(250px, 32vh)',
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  padding: '1rem 0.1rem 0.12rem',
  WebkitMaskImage: 'linear-gradient(to top, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.96) 58%, rgba(0, 0, 0, 0.28) 88%, rgba(0, 0, 0, 0) 100%)',
  maskImage: 'linear-gradient(to top, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.96) 58%, rgba(0, 0, 0, 0.28) 88%, rgba(0, 0, 0, 0) 100%)',
};

export const plannerMessageBaseCardStyle: React.CSSProperties = {
  borderRadius: '0.55rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  padding: '0.52rem 0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.26rem',
};

export const plannerMessageUserCardStyle: React.CSSProperties = {
  ...plannerMessageBaseCardStyle,
  background: 'rgba(239, 246, 255, 0.92)',
};

export const plannerMessageAssistantCardStyle: React.CSSProperties = {
  ...plannerMessageBaseCardStyle,
  background: 'rgba(236, 253, 245, 0.9)',
};

export const plannerMessageSystemCardStyle: React.CSSProperties = {
  ...plannerMessageBaseCardStyle,
  background: 'rgba(241, 245, 249, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.3)',
};

export const plannerMessageRoleStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const plannerMessageTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  lineHeight: 1.5,
  color: '#1e293b',
};

export const canvasPaneStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

export const planningCanvasOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 52,
  background: 'rgba(226, 232, 240, 0.38)',
  backdropFilter: 'blur(2px)',
  pointerEvents: 'auto',
};

export const canvasFloatingActionsStyle: React.CSSProperties = {
  position: 'absolute',
  top: '0.85rem',
  right: '0.85rem',
  zIndex: 78,
  width: 'min(420px, calc(100% - 1.7rem))',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  alignItems: 'flex-end',
  pointerEvents: 'none',
};

export const canvasFloatingActionsMobileStyle: React.CSSProperties = {
  top: '0.6rem',
  right: '0.6rem',
  width: 'min(320px, calc(100% - 1.2rem))',
  gap: '0.42rem',
};

export const canvasFloatingActionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.42rem',
  flexWrap: 'wrap',
  pointerEvents: 'auto',
};

export const canvasFloatingActionRowMobileStyle: React.CSSProperties = {
  width: '100%',
  justifyContent: 'flex-end',
};

export const canvasFloatingDetailButtonStyle: React.CSSProperties = {
  maxWidth: '100%',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: '999px',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#0f172a',
  padding: '0.26rem 0.7rem',
  cursor: 'pointer',
  boxShadow: '0 12px 30px -24px rgba(15, 23, 42, 0.9)',
};

export const canvasFloatingDetailLabelStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '220px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.78rem',
  fontWeight: 700,
};

export const emptySelectionOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 70,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.84) 0%, rgba(226, 232, 240, 0.94) 100%)',
  backdropFilter: 'blur(10px)',
};

export const emptySelectionOverlayMobileStyle: React.CSSProperties = {
  padding: '0.85rem',
};

export const emptySelectionCardStyle: React.CSSProperties = {
  width: 'min(520px, 100%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.7rem',
  padding: '1.2rem 1.1rem',
  borderRadius: '1rem',
  border: '1px solid rgba(14, 116, 144, 0.16)',
  background: 'rgba(255, 255, 255, 0.92)',
  boxShadow: '0 26px 60px -42px rgba(15, 23, 42, 0.9)',
  textAlign: 'center',
};

export const emptySelectionEyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#0f766e',
};

export const emptySelectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.18rem',
  lineHeight: 1.35,
  color: '#0f172a',
};

export const emptySelectionTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  lineHeight: 1.6,
  color: '#475569',
};
