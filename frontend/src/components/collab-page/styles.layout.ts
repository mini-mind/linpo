import type React from 'react';
import type { CollabTaskDetailModalStyles } from '../collabTaskDetailModal';
import { getWorkspaceDesktopTwoColumnMainStyle, getWorkspaceDesktopTwoColumnShellStyle, WORKSPACE_NARROW_MOBILE_BREAKPOINT_PX } from '../workspaceLayout';

// 边界说明：该文件仅承载 CollabPage 的样式常量与纯样式函数，不包含业务状态。

export const pageStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
  background: 'transparent',
};

export const mobileBoardFabStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 70,
  border: '1px solid rgba(14, 116, 144, 0.42)',
  borderRadius: '999px',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  fontSize: '0.78rem',
  fontWeight: 700,
  padding: '0.52rem 0.84rem',
  boxShadow: '0 12px 24px -22px rgba(15, 23, 42, 0.95)',
  cursor: 'pointer',
};

export const mobileBoardMenuOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 120,
  background: 'rgba(15, 23, 42, 0.28)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  padding: '0.9rem 0.6rem 0.6rem',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
};

export const mobileBoardMenuCardStyle: React.CSSProperties = {
  width: 'min(92vw, 420px)',
  maxWidth: '100%',
  maxHeight: '100%',
  border: '1px solid rgba(148, 163, 184, 0.32)',
  borderRadius: '0.82rem',
  background: 'rgba(255, 255, 255, 0.97)',
  boxShadow: '0 22px 42px -30px rgba(15, 23, 42, 0.92)',
  padding: '0.72rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.62rem',
  overflowY: 'auto',
};

export const mobileBoardMenuHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

export const mobileBoardMenuTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const mobileBoardMenuCloseStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.42)',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#334155',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.58rem',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const mobileBoardMenuStatsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.45rem',
};

export const mobileBoardMenuFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.28rem',
};

export const mobileBoardMenuLabelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#334155',
};

export const boardFrameStyle: React.CSSProperties = {
  width: '100%',
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0 0.85rem 0.85rem',
  boxSizing: 'border-box',
};

export const boardFrameMobileStyle: React.CSSProperties = {
  ...boardFrameStyle,
  padding: '0 0.5rem 0.5rem',
};

export const boardFrameDesktopStyle: React.CSSProperties = {
  ...boardFrameStyle,
  padding: 0,
};

export const boardShellStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  padding: '0 0 0.85rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
  boxSizing: 'border-box',
};

export const boardShellMobileStyle: React.CSSProperties = {
  ...boardShellStyle,
  padding: '0 0 0.5rem',
  gap: '0.55rem',
};

export const desktopBoardShellStyle: React.CSSProperties = getWorkspaceDesktopTwoColumnShellStyle({
  sidebarWidthPx: 280,
  // 保持当前页面的视觉风格，只复用双栏骨架能力。
  extra: {
    background: 'rgba(255, 255, 255, 0.72)',
  },
});

export const desktopSidebarStyle: React.CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
  padding: '0.9rem 0.82rem 0.9rem 0.94rem',
  background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.96) 0%, rgba(241, 245, 249, 0.9) 100%)',
  borderRight: '1px solid rgba(148, 163, 184, 0.22)',
};

export const desktopSidebarSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
};

export const desktopSidebarTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const desktopSidebarHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  lineHeight: 1.45,
  color: '#64748b',
};

export const desktopBoardMainStyle: React.CSSProperties = getWorkspaceDesktopTwoColumnMainStyle();

export const statsItemStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(255, 255, 255, 0.6)',
  color: '#334155',
  borderRadius: '0.35rem',
  padding: '0.22rem 0.5rem',
  fontSize: '0.76rem',
  fontWeight: 600,
};

export const flatActionButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  background: 'rgba(255, 255, 255, 0.72)',
  color: '#1f2937',
  borderRadius: '0.35rem',
  padding: '0.4rem 0.68rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const flatActionButtonMobileStyle: React.CSSProperties = {
  flex: '0 0 auto',
  whiteSpace: 'nowrap',
};

export const modalLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#334155',
  fontWeight: 600,
};

export const viewSelectStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.72)',
};

export const viewSelectMobileStyle: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
};

export const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 140,
};

export const modalOverlayMobileStyle: React.CSSProperties = {
  alignItems: 'flex-start',
  overflowY: 'auto',
  padding: '0.75rem',
};

export const modalCardStyle: React.CSSProperties = {
  width: 'min(520px, calc(100vw - 2rem))',
  borderRadius: '0.65rem',
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

export const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const modalInputTextStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.65rem',
  fontSize: '0.85rem',
};

export const modalTextareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '5.6rem',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.65rem',
  fontSize: '0.85rem',
  resize: 'vertical',
};

export const modalActionStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.45rem',
  justifyContent: 'flex-end',
};

export const taskDetailCardStyle: React.CSSProperties = {
  ...modalCardStyle,
  width: 'min(1080px, calc(100vw - 1.5rem))',
  height: 'min(860px, calc(100dvh - 1.5rem))',
  maxHeight: 'calc(100dvh - 1.5rem)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.65rem',
};

export const taskDetailCardMobileStyle: React.CSSProperties = {
  width: '100%',
  height: 'auto',
  minHeight: 'calc(100dvh - 1.5rem)',
  maxHeight: 'calc(100dvh - 1.5rem)',
  padding: '0.72rem',
};

export const taskDetailTitleStyle: React.CSSProperties = {
  margin: '0',
  fontSize: '0.98rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const taskDetailTopRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
  flexShrink: 0,
};

export const taskDetailTopRowMobileStyle: React.CSSProperties = {
  alignItems: 'stretch',
  flexDirection: 'column',
};

export const taskDetailTopTitleBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.18rem',
  minWidth: 0,
};

export const taskDetailTabsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.42rem',
  flexWrap: 'wrap',
  flexShrink: 0,
};

export const taskDetailTabsMobileStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
};

export const taskDetailTabButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.32)',
  background: 'rgba(248, 250, 252, 0.86)',
  color: '#334155',
  borderRadius: '0.4rem',
  padding: '0.3rem 0.62rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const taskDetailTabButtonActiveStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.42)',
  background: 'rgba(239, 246, 255, 0.94)',
  color: '#0c4a6e',
};

export const taskInfoPanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.44rem',
  borderRadius: '0.56rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(248, 250, 252, 0.86)',
  padding: '0.58rem',
  flexShrink: 0,
};

export const taskDetailMetaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
  gap: '0.38rem',
  minWidth: 0,
};

export const taskDetailDescriptionWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

export const taskDetailSectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#1e293b',
};

export const taskDetailSummaryStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#475569',
  lineHeight: 1.45,
};

export const taskKeyFieldsCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.5rem',
  background: 'rgba(255, 255, 255, 0.86)',
  padding: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
  minWidth: 0,
};

export const taskMetaFieldItemStyle: React.CSSProperties = {
  minWidth: 0,
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: '0.42rem',
  background: 'rgba(248, 250, 252, 0.85)',
  padding: '0.32rem 0.4rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.16rem',
};

export const taskMetaFieldLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.68rem',
  color: '#64748b',
  fontWeight: 700,
  lineHeight: 1.35,
};

export const taskMetaFieldValueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#0f172a',
  fontWeight: 600,
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  whiteSpace: 'normal',
};

export const dependencyListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.26rem',
};

export const dependencyItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.48rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.86)',
  padding: '0.24rem 0.42rem',
};

export const dependencyNameStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: '#0f172a',
  fontWeight: 600,
  lineHeight: 1.35,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const dependencyStatusStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#475569',
  whiteSpace: 'nowrap',
};

export const taskControlActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-start',
  alignItems: 'center',
  gap: '0.42rem',
  flexWrap: 'wrap',
  marginTop: '0.08rem',
};

export const taskControlDangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(220, 38, 38, 0.42)',
  background: 'rgba(254, 242, 242, 0.94)',
  color: '#991b1b',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.62rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const taskControlPrimaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.38)',
  background: 'rgba(239, 246, 255, 0.94)',
  color: '#0c4a6e',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.62rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const taskControlHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  color: '#64748b',
  fontWeight: 600,
};

export const taskDetailBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.54rem',
};

export const taskOutputPanelStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  borderRadius: '0.56rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255, 255, 255, 0.78)',
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.48rem',
};

export const taskOutputHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
  flexShrink: 0,
};

export const taskOutputLayoutStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '260px minmax(0, 1fr)',
  gap: '0.48rem',
};

export const taskOutputLayoutMobileStyle: React.CSSProperties = {
  ...taskOutputLayoutStyle,
  gridTemplateColumns: '1fr',
  gridTemplateRows: '140px minmax(0, 1fr)',
};

export const taskOutputListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.36rem',
  paddingRight: '0.12rem',
};

export const taskOutputListMobileStyle: React.CSSProperties = {
  ...taskOutputListStyle,
  flexDirection: 'row',
  overflowX: 'auto',
  overflowY: 'hidden',
  paddingBottom: '0.2rem',
};

export const taskOutputItemButtonStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(248, 250, 252, 0.82)',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.48rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  textAlign: 'left',
  cursor: 'pointer',
};

export const taskOutputItemActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(14, 116, 144, 0.42)',
  background: 'rgba(239, 246, 255, 0.92)',
};

export const taskOutputItemTypeStyle: React.CSSProperties = {
  fontSize: '0.67rem',
  color: '#0369a1',
  fontWeight: 700,
};

export const taskOutputItemTitleStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#1e293b',
  fontWeight: 600,
  lineHeight: 1.35,
  wordBreak: 'break-word',
};

export const taskOutputPreviewStyle: React.CSSProperties = {
  minHeight: 0,
  borderRadius: '0.46rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(255, 255, 255, 0.88)',
  padding: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.44rem',
};

export const taskOutputMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
  flexWrap: 'wrap',
};

export const taskOutputDownloadLinkStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  background: 'rgba(255, 255, 255, 0.72)',
  color: '#1f2937',
  borderRadius: '0.35rem',
  padding: '0.26rem 0.52rem',
  fontSize: '0.74rem',
  fontWeight: 700,
  textDecoration: 'none',
};

export const taskOutputMarkdownWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  paddingRight: '0.12rem',
};

export const taskSessionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  flexWrap: 'wrap',
  flexShrink: 0,
};

export const taskSessionPanelStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  borderRadius: '0.56rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255, 255, 255, 0.7)',
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.44rem',
};

export const taskSessionListStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
  paddingRight: '0.18rem',
};

export const taskSessionRoleStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const taskSessionTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#1e293b',
  lineHeight: 1.45,
};

export const taskSessionErrorTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#b91c1c',
  lineHeight: 1.45,
};

export const toolCallDetailsStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.44rem',
  background: 'rgba(248, 250, 252, 0.88)',
  padding: '0.3rem 0.42rem',
};

export const toolCallSummaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#0f172a',
  userSelect: 'none',
  outline: 'none',
};

export const toolCallDetailBodyStyle: React.CSSProperties = {
  marginTop: '0.38rem',
  borderTop: '1px dashed rgba(148, 163, 184, 0.38)',
  paddingTop: '0.36rem',
  maxHeight: '188px',
  overflowY: 'auto',
};

export const toolCallDetailHintStyle: React.CSSProperties = {
  margin: '0 0 0.26rem 0',
  fontSize: '0.7rem',
  color: '#64748b',
};

export const collabTaskDetailModalStyles: CollabTaskDetailModalStyles = {
  modalOverlayStyle,
  modalOverlayMobileStyle,
  taskDetailCardStyle,
  taskDetailCardMobileStyle,
  taskDetailTopRowStyle,
  taskDetailTopRowMobileStyle,
  taskDetailTopTitleBlockStyle,
  modalTitleStyle,
  taskDetailTitleStyle,
  flatActionButtonStyle,
  flatActionButtonMobileStyle,
  taskDetailTabsStyle,
  taskDetailTabsMobileStyle,
  taskDetailTabButtonStyle,
  taskDetailTabButtonActiveStyle,
  taskDetailBodyStyle,
  taskInfoPanelStyle,
  taskDetailDescriptionWrapStyle,
  taskDetailSectionTitleStyle,
  taskDetailSummaryStyle,
  taskKeyFieldsCardStyle,
  taskDetailMetaGridStyle,
  taskMetaFieldItemStyle,
  taskMetaFieldLabelStyle,
  taskMetaFieldValueStyle,
  taskControlActionsStyle,
  taskControlDangerButtonStyle,
  taskControlPrimaryButtonStyle,
  taskControlHintStyle,
  dependencyListStyle,
  dependencyItemStyle,
  dependencyNameStyle,
  dependencyStatusStyle,
  taskOutputPanelStyle,
  taskOutputHeaderStyle,
  taskOutputLayoutStyle,
  taskOutputLayoutMobileStyle,
  taskOutputListStyle,
  taskOutputListMobileStyle,
  taskOutputItemButtonStyle,
  taskOutputItemActiveStyle,
  taskOutputItemTypeStyle,
  taskOutputItemTitleStyle,
  taskOutputPreviewStyle,
  taskOutputMetaStyle,
  taskOutputDownloadLinkStyle,
  taskOutputMarkdownWrapStyle,
  taskSessionErrorTextStyle,
  taskSessionTextStyle,
  taskSessionPanelStyle,
  taskSessionHeaderStyle,
  taskSessionListStyle,
  taskSessionRoleStyle,
  toolCallDetailsStyle,
  toolCallSummaryStyle,
  toolCallDetailBodyStyle,
  toolCallDetailHintStyle,
};
