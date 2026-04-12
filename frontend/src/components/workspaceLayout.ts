import type React from 'react';

export const WORKSPACE_TOOLBAR_MAX_WIDTH_PX = 1520;
export const WORKSPACE_CONTENT_MAX_WIDTH_PX = 1520;
export const WORKSPACE_SUMMARY_MAX_WIDTH_PX = 1360;
export const WORKSPACE_KANBAN_MAX_WIDTH_PX = 1680;
export const WORKSPACE_ULTRAWIDE_BREAKPOINT_PX = 1680;
export const WORKSPACE_NARROW_MOBILE_BREAKPOINT_PX = 560;

type FrameOptions = {
  isMobile: boolean;
  maxWidthPx?: number;
  desktopPadding?: string;
  mobilePadding?: string;
  extra?: React.CSSProperties;
};

type StyleOptions = {
  extra?: React.CSSProperties;
};

type DesktopTwoColumnShellOptions = {
  sidebarWidthPx?: number;
  extra?: React.CSSProperties;
};

export function getWorkspaceFrameStyle(options: FrameOptions): React.CSSProperties {
  const {
    isMobile,
    maxWidthPx = WORKSPACE_CONTENT_MAX_WIDTH_PX,
    desktopPadding = '0 0.85rem',
    mobilePadding = '0 0.5rem',
    extra,
  } = options;

  return {
    width: '100%',
    maxWidth: isMobile ? '100%' : `${maxWidthPx}px`,
    margin: '0 auto',
    boxSizing: 'border-box',
    padding: isMobile ? mobilePadding : desktopPadding,
    ...extra,
  };
}

export function getWorkspaceToolbarInnerStyle(options: FrameOptions): React.CSSProperties {
  return getWorkspaceFrameStyle(options);
}

export function getWorkspacePageStyle(options?: StyleOptions): React.CSSProperties {
  return {
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.55rem',
    overflow: 'hidden',
    ...(options?.extra ?? {}),
  };
}

export function getWorkspaceBodyShellStyle(options: FrameOptions): React.CSSProperties {
  const {
    isMobile,
    desktopPadding = '0 0.85rem 0.85rem',
    mobilePadding = '0 0.5rem 0.5rem',
    extra,
  } = options;

  return {
    flex: 1,
    minHeight: 0,
    width: '100%',
    padding: isMobile ? mobilePadding : desktopPadding,
    display: 'flex',
    justifyContent: 'center',
    boxSizing: 'border-box',
    ...(extra ?? {}),
  };
}

export function getWorkspaceBodyInnerStyle(options: FrameOptions): React.CSSProperties {
  const {
    isMobile,
    maxWidthPx = WORKSPACE_CONTENT_MAX_WIDTH_PX,
    extra,
  } = options;

  return {
    width: '100%',
    maxWidth: isMobile ? '100%' : `${maxWidthPx}px`,
    minHeight: 0,
    flex: 1,
    ...(extra ?? {}),
  };
}

export function getWorkspaceDesktopTwoColumnShellStyle(
  options?: DesktopTwoColumnShellOptions,
): React.CSSProperties {
  const { sidebarWidthPx = 280, extra } = options ?? {};

  return {
    flex: 1,
    minHeight: 0,
    width: '100%',
    display: 'grid',
    // 设计意图：左侧固定宽度，右侧主内容使用 minmax(0, 1fr) 避免内容把网格撑爆产生留白。
    gridTemplateColumns: `${sidebarWidthPx}px minmax(0, 1fr)`,
    // 默认无列间距，保证双栏紧贴，避免出现视觉留白。
    gap: 0,
    // 壳层统一裁剪溢出，避免内层阴影/动画造成外层空白滚动区域。
    overflow: 'hidden',
    ...(extra ?? {}),
  };
}

export function getWorkspaceDesktopTwoColumnMainStyle(options?: StyleOptions): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    // 主区域默认不加内边距，具体页面按需叠加，避免基础层引入额外留白。
    padding: 0,
    ...(options?.extra ?? {}),
  };
}
