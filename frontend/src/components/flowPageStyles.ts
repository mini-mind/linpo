import type React from 'react';
import {
  CONNECTOR_OFFSET,
  HEADER_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './flowPageStateUtils';

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

export const flowDesktopShellStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '280px minmax(0, 1fr)',
  gap: 0,
  overflow: 'hidden',
};

export const flowDesktopCanvasWrapStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  padding: 0,
};

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
  zIndex: 85,
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
  maxHeight: 'calc(100vh - 5rem)',
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
  maxHeight: 'calc(100vh - 1.5rem)',
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
