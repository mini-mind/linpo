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
