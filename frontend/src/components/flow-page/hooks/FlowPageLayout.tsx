import type React from 'react';
import type { ComponentProps } from 'react';

import { FlowCanvasPane } from '../FlowCanvasPane';
import { FlowPageDialogs } from '../FlowPageDialogs';
import { FlowPlannerPanel } from '../FlowPlannerPanel';
import { FlowSidebar } from '../FlowSidebar';
import {
  canvasPaneStyle,
  flowCanvasAnimationStyleText,
  flowDesktopCanvasWrapStyle,
  flowDesktopShellStyle,
  flowSidebarDesktopStyle,
  flowSidebarDrawerOverlayStyle,
  flowSidebarDrawerStyle,
  flowWorkspaceMobileStyle,
  pageStyle,
} from '../../flowPageStyles';

type FlowSidebarProps = Omit<ComponentProps<typeof FlowSidebar>, 'mode'>;
type FlowCanvasPaneProps = ComponentProps<typeof FlowCanvasPane>;
type FlowPlannerPanelProps = ComponentProps<typeof FlowPlannerPanel>;
type FlowPageDialogsProps = ComponentProps<typeof FlowPageDialogs>;

export type FlowPageLayoutProps = {
  isMobile: boolean;
  isMobileFlowSidebarOpen: boolean;
  setIsMobileFlowSidebarOpen: (next: boolean) => void;
  mobileFlowListFabStyle: React.CSSProperties;
  flowFabPosition: { x: number; y: number };
  onFlowFabPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onFlowFabClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  mobileFlowSidebarTriggerRef: (node: HTMLButtonElement | null) => void;
  sidebarProps: FlowSidebarProps;
  dialogsProps: FlowPageDialogsProps;
  canvasPaneProps: FlowCanvasPaneProps;
  plannerPanelProps: FlowPlannerPanelProps;
};

export function FlowPageLayout(props: FlowPageLayoutProps): JSX.Element {
  const {
    isMobile,
    isMobileFlowSidebarOpen,
    setIsMobileFlowSidebarOpen,
    mobileFlowListFabStyle,
    flowFabPosition,
    onFlowFabPointerDown,
    onFlowFabClick,
    mobileFlowSidebarTriggerRef,
    sidebarProps,
    dialogsProps,
    canvasPaneProps,
    plannerPanelProps,
  } = props;

  const canvasPaneNode = (
    <div style={canvasPaneStyle}>
      <FlowCanvasPane {...canvasPaneProps} />
      <FlowPlannerPanel {...plannerPanelProps} />
    </div>
  );

  return (
    <section style={pageStyle} aria-label="flow-page">
      <style>{flowCanvasAnimationStyleText}</style>

      {isMobile && !isMobileFlowSidebarOpen ? (
        <button
          type="button"
          style={{
            ...mobileFlowListFabStyle,
            left: `${flowFabPosition.x}px`,
            top: `${flowFabPosition.y}px`,
            touchAction: 'none',
          }}
          onPointerDown={onFlowFabPointerDown}
          onClick={onFlowFabClick}
          aria-label="流程列表"
          ref={mobileFlowSidebarTriggerRef}
        >
          流程列表
        </button>
      ) : null}

      {isMobile && isMobileFlowSidebarOpen ? (
        <div
          style={flowSidebarDrawerOverlayStyle}
          role="dialog"
          aria-modal="true"
          aria-label="流程列表抽屉"
          onClick={() => setIsMobileFlowSidebarOpen(false)}
        >
          <aside
            style={flowSidebarDrawerStyle}
            aria-label="流程列表侧栏"
            data-testid="flow-sidebar"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setIsMobileFlowSidebarOpen(false);
              }
            }}
          >
            <FlowSidebar mode="drawer" {...sidebarProps} />
          </aside>
        </div>
      ) : null}

      <FlowPageDialogs {...dialogsProps} />

      {isMobile ? (
        <div style={flowWorkspaceMobileStyle}>{canvasPaneNode}</div>
      ) : (
        <div style={flowDesktopShellStyle}>
          <aside style={flowSidebarDesktopStyle} aria-label="流程列表侧栏" data-testid="flow-sidebar">
            <FlowSidebar mode="desktop" {...sidebarProps} />
          </aside>
          <div style={flowDesktopCanvasWrapStyle}>{canvasPaneNode}</div>
        </div>
      )}
    </section>
  );
}
