import type React from 'react';

export const INSTANCE_FILES_SIDEBAR_WIDTH_PX = 320;
export const INSTANCE_FILES_SIDEBAR_MIN_WIDTH_PX = 240;
export const INSTANCE_FILES_SIDEBAR_MAX_WIDTH_PX = 560;
export const INSTANCE_FILES_SIDEBAR_RESIZER_WIDTH_PX = 10;
export const INSTANCE_FILES_PREVIEW_CONTENT_MAX_WIDTH_PX = 960;

export const searchInputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.72)',
};

export const searchInputMobileStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
};

export const mobileFabButtonStyle: React.CSSProperties = {
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

export const mobileSidebarDrawerOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 90,
  background: 'rgba(15, 23, 42, 0.28)',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'flex-start',
  padding: '0.9rem 0.6rem 0.6rem',
};

export const mobileSidebarDrawerPanelStyle: React.CSSProperties = {
  width: 'min(92vw, 420px)',
  maxWidth: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

export const mobileSidebarDrawerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.55rem',
};

export const mobileSidebarDrawerTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  fontWeight: 700,
  color: '#f8fafc',
};

export const mobileSidebarDrawerCloseStyle: React.CSSProperties = {
  border: '1px solid rgba(226, 232, 240, 0.44)',
  background: 'rgba(15, 23, 42, 0.4)',
  color: '#e2e8f0',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.58rem',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const bodyShellMobileStyle: React.CSSProperties = {};

export const bodyShellDesktopStyle: React.CSSProperties = {
  padding: 0,
};

// 文件页采用整页贴边布局：去掉页面级默认 gap，避免出现外层留白。
export const workspacePageEdgeStyle: React.CSSProperties = {
  gap: 0,
};

export const bodyInnerDesktopStyle: React.CSSProperties = {
  maxWidth: '100%',
  minWidth: 0,
  minHeight: 0,
  // 让内部 desktop shell 的 flex:1 生效，避免“同步中短内容”阶段按内容高度坍塌。
  display: 'flex',
  flexDirection: 'column',
};

export function getBodyStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: '100%',
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: '1fr',
    gridTemplateRows: isMobile ? 'minmax(220px, 36vh) minmax(0, 1fr)' : 'minmax(0, 1fr)',
    gap: '0.75rem',
    overflow: 'hidden',
    flex: 1,
  };
}

// 桌面端保持“侧栏 + 主区”两列，拖拽手柄采用覆盖层，避免第三列带来的中缝留白。
export function getDesktopShellStyle(sidebarWidth: number): React.CSSProperties {
  return {
    ...desktopShellBaseStyle,
    gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)`,
  };
}

export const desktopShellBaseStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gap: 0,
  overflow: 'hidden',
  background: 'rgba(255, 255, 255, 0.72)',
  position: 'relative',
};

export const sidebarResizeHandleStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: `${INSTANCE_FILES_SIDEBAR_RESIZER_WIDTH_PX}px`,
  cursor: 'col-resize',
  touchAction: 'none',
  transform: 'translateX(-50%)',
  zIndex: 2,
  background:
    'linear-gradient(90deg, rgba(148, 163, 184, 0) 0%, rgba(148, 163, 184, 0.36) 50%, rgba(148, 163, 184, 0) 100%)',
};

export const sidebarResizeHandleActiveStyle: React.CSSProperties = {
  background:
    'linear-gradient(90deg, rgba(14, 116, 144, 0) 0%, rgba(14, 116, 144, 0.64) 50%, rgba(14, 116, 144, 0) 100%)',
};

export const listPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.88rem',
  background: 'rgba(255, 255, 255, 0.8)',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0.72rem',
  gap: '0.7rem',
};

export const desktopSidebarStyle: React.CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
  padding: '0.95rem 0.9rem 1rem',
  background: 'linear-gradient(180deg, rgba(248,250,252,0.96) 0%, rgba(241,245,249,0.9) 100%)',
};

export const sidebarHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.54rem',
  paddingBottom: '0.78rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.22)',
};

export const treeSectionStyle: React.CSSProperties = {
  minHeight: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

export const agentDocSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  paddingTop: '0.55rem',
  borderTop: '1px solid rgba(148, 163, 184, 0.2)',
};

export const agentDocToggleStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderRadius: '0.45rem',
  background: 'rgba(226, 232, 240, 0.26)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
  padding: '0.35rem 0.45rem',
  cursor: 'pointer',
  textAlign: 'left',
};

export const agentDocToggleCaretStyle: React.CSSProperties = {
  fontSize: '0.76rem',
  color: '#64748b',
  lineHeight: 1,
};

export const agentDocListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  maxHeight: '180px',
  overflowY: 'auto',
  paddingRight: '0.15rem',
};

export const agentGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.12rem',
};

export const agentGroupChildrenStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.16rem',
  paddingLeft: '0.92rem',
};

export const treeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

export const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const treeHeaderAddButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.4)',
  borderRadius: '999px',
  width: '24px',
  height: '24px',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(224, 242, 254, 0.9)',
  color: '#0369a1',
  fontSize: '1rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const treeWrapStyle: React.CSSProperties = {
  minHeight: 0,
  flex: 1,
  overflowY: 'auto',
  paddingRight: '0.15rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.22rem',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-y',
};

export const taskSourceBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.14rem 0.45rem',
  borderRadius: '999px',
  background: 'rgba(2, 132, 199, 0.12)',
  color: '#0369a1',
  fontSize: '0.66rem',
  fontWeight: 700,
};

export const agentDocSourceBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.14rem 0.45rem',
  borderRadius: '999px',
  background: 'rgba(15, 118, 110, 0.12)',
  color: '#0f766e',
  fontSize: '0.66rem',
  fontWeight: 700,
};

export const previewPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.88rem',
  background: 'rgba(255, 255, 255, 0.84)',
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0.72rem',
  gap: '0.62rem',
};

export const desktopPreviewPanelStyle: React.CSSProperties = {
  flex: 1,
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.72rem',
  padding: '0.95rem 1rem 1rem',
};

export const previewHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.75rem',
  flexWrap: 'wrap',
};

export const previewHeaderCopyStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

export const previewTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  flexWrap: 'wrap',
};

export const previewTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 800,
  color: '#0f172a',
};

export const previewSubtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#52616f',
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
};

export const previewActionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  flexWrap: 'wrap',
};

export const actionLinkStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 118, 110, 0.35)',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.58rem',
  background: 'rgba(236, 253, 245, 0.9)',
  color: '#0f766e',
  fontSize: '0.74rem',
  textDecoration: 'none',
  fontWeight: 600,
};

export const actionButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.44)',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.58rem',
  background: 'rgba(255, 255, 255, 0.92)',
  color: '#0f172a',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

export const actionPrimaryButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  border: '1px solid rgba(14, 116, 144, 0.46)',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
};

export const actionDangerButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  border: '1px solid rgba(185, 28, 28, 0.42)',
  background: 'rgba(254, 242, 242, 0.92)',
  color: '#b91c1c',
};

export const createDialogOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.36)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
  zIndex: 120,
};

export const createDialogCardStyle: React.CSSProperties = {
  width: 'min(520px, 100%)',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: '#ffffff',
  boxShadow: '0 18px 42px rgba(15, 23, 42, 0.22)',
  padding: '16px',
  display: 'grid',
  gap: '12px',
};

export const createDialogTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#0f172a',
};

export const createDialogLabelStyle: React.CSSProperties = {
  display: 'grid',
  gap: '6px',
  fontSize: '0.78rem',
  color: '#334155',
};

export const createDialogSelectStyle: React.CSSProperties = {
  borderRadius: '8px',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  background: '#fff',
  color: '#0f172a',
  fontSize: '0.82rem',
  padding: '8px 10px',
};

export const createDialogInputStyle: React.CSSProperties = {
  borderRadius: '8px',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  background: '#fff',
  color: '#0f172a',
  fontSize: '0.82rem',
  padding: '8px 10px',
};

export const createDialogActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
};

export const metaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '0.42rem',
};

export const metaGridMobileStyle: React.CSSProperties = {
  gridTemplateColumns: '1fr',
};

export const metaItemStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#334155',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export const metaItemMobileStyle: React.CSSProperties = {
  whiteSpace: 'normal',
  overflow: 'visible',
  textOverflow: 'clip',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

export const previewBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  borderRadius: '0.72rem',
  background: 'rgba(248, 250, 252, 0.8)',
  overflow: 'auto',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-y',
};

export const desktopPreviewBodyStyle: React.CSSProperties = {
  ...previewBodyStyle,
  // 数据切换渲染期间保持稳定可视高度，避免主区瞬时按内容高度坍塌。
  minHeight: '260px',
  background: 'rgba(248, 250, 252, 0.64)',
};

export const previewContentShellStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: `${INSTANCE_FILES_PREVIEW_CONTENT_MAX_WIDTH_PX}px`,
  margin: '0 auto',
  padding: '0.82rem',
  boxSizing: 'border-box',
};

// 桌面端预览内容不再居中限宽，避免主区左侧出现“先空白再内容”的视觉断层。
export const desktopPreviewContentShellStyle: React.CSSProperties = {
  ...previewContentShellStyle,
  maxWidth: '100%',
  margin: 0,
};

export const loadingPlaceholderPanelStyle: React.CSSProperties = {
  border: '1px dashed rgba(148, 163, 184, 0.42)',
  borderRadius: '0.56rem',
  background: 'rgba(255, 255, 255, 0.72)',
  padding: '0.72rem',
};

export const loadingPlaceholderSubtextStyle: React.CSSProperties = {
  margin: '0.35rem 0 0',
  fontSize: '0.74rem',
  color: '#64748b',
  lineHeight: 1.45,
};

export const editorTextareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '300px',
  boxSizing: 'border-box',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.5rem',
  padding: '0.56rem',
  background: 'rgba(255, 255, 255, 0.96)',
  color: '#0f172a',
  fontSize: '0.82rem',
  lineHeight: 1.5,
  resize: 'vertical',
};

export const jsonStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: '0.74rem',
  color: '#0f172a',
  lineHeight: 1.45,
};

export const textStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#0f172a',
  lineHeight: 1.5,
};

export const imageStyle: React.CSSProperties = {
  maxWidth: '100%',
  height: 'auto',
  borderRadius: '0.42rem',
  border: '1px solid rgba(148, 163, 184, 0.26)',
  display: 'block',
  margin: '0 auto',
};

export const hintTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#64748b',
};

export const errorTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#b91c1c',
};

export function getTreeFolderStyle(depth: number): React.CSSProperties {
  return {
    marginLeft: `${depth * 14}px`,
    paddingLeft: '0.6rem',
    borderLeft: depth > 0 ? '1px solid rgba(148, 163, 184, 0.28)' : 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.22rem',
  };
}

export function clampSidebarWidth(width: number): number {
  return Math.min(
    INSTANCE_FILES_SIDEBAR_MAX_WIDTH_PX,
    Math.max(INSTANCE_FILES_SIDEBAR_MIN_WIDTH_PX, width)
  );
}

export const treeCaretIconStyle: React.CSSProperties = {
  color: '#64748b',
  flexShrink: 0,
};

export const fileTypeIconStyle: React.CSSProperties = {
  color: '#64748b',
  flexShrink: 0,
};

export function getTreeLeafStyle(active: boolean, depth: number): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    marginLeft: `${depth * 14}px`,
    padding: '0.34rem 0.3rem',
    border: 'none',
    borderRadius: '0.45rem',
    background: active ? 'rgba(224, 242, 254, 0.82)' : 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'block',
  };
}

export function getTreeFolderToggleStyle(expanded: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.26rem 0.32rem',
    border: 'none',
    borderRadius: '0.42rem',
    background: expanded ? 'rgba(241, 245, 249, 0.8)' : 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'block',
  };
}

export function getAgentGroupToggleStyle(expanded: boolean): React.CSSProperties {
  return {
    ...getTreeFolderToggleStyle(expanded),
    background: expanded ? 'rgba(236, 253, 245, 0.72)' : 'transparent',
  };
}

export function getAgentDocItemStyle(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.32rem 0.36rem',
    border: 'none',
    borderRadius: '0.45rem',
    background: active ? 'rgba(236, 253, 245, 0.88)' : 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'block',
  };
}

export const treeLeafNameWrapStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '0.34rem',
};

export const treeLeafNameStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: '0.76rem',
  fontWeight: 700,
  color: '#0f172a',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
