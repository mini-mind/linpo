export const boardViewportStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  flex: 1,
  minHeight: 0,
  borderRadius: '0.6rem',
  overflowX: 'auto',
  overflowY: 'hidden',
  overscrollBehaviorX: 'contain',
};

export const mobileBoardViewportStyle: React.CSSProperties = {
  ...boardViewportStyle,
  overflowX: 'auto',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-x',
  overscrollBehavior: 'contain',
};

export function getBoardViewportStyle(params: { isMobile: boolean; isNarrowMobileBoard: boolean }): React.CSSProperties {
  const { isMobile, isNarrowMobileBoard } = params;
  if (isNarrowMobileBoard) {
    return {
      ...mobileBoardViewportStyle,
      overflowX: 'hidden',
      touchAction: 'pan-y',
    };
  }
  return isMobile ? mobileBoardViewportStyle : boardViewportStyle;
}

export const boardTrackStyle: React.CSSProperties = {
  height: '100%',
  width: 'max-content',
  minWidth: 'max-content',
  display: 'flex',
  gap: '0.65rem',
  alignItems: 'flex-start',
};

export const KANBAN_COLUMN_WIDTH_PX = 280;
export const KANBAN_MOBILE_COLUMN_VW = 57;
export const KANBAN_MOBILE_COLUMN_MIN_PX = 220;
export const KANBAN_MOBILE_COLUMN_MAX_PX = 374;
export const KANBAN_COLLAPSED_COLUMN_WIDTH_PX = 52;
export const KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX = 46;

export const mobileBoardTrackStyle: React.CSSProperties = {
  ...boardTrackStyle,
  paddingBottom: '0.25rem',
  paddingRight: '0.25rem',
};

export function getBoardTrackStyle(params: {
  isMobile: boolean;
  isNarrowMobileBoard: boolean;
}): React.CSSProperties {
  const { isMobile, isNarrowMobileBoard } = params;
  if (isNarrowMobileBoard) {
    return {
      ...mobileBoardTrackStyle,
      width: '100%',
      minWidth: '100%',
      paddingRight: 0,
      justifyContent: 'stretch',
    };
  }
  return {
    ...(isMobile ? mobileBoardTrackStyle : boardTrackStyle),
    minWidth: 'max-content',
    justifyContent: 'flex-start',
  };
}

export const columnStyle: React.CSSProperties = {
  width: `${KANBAN_COLUMN_WIDTH_PX}px`,
  flex: `0 0 ${KANBAN_COLUMN_WIDTH_PX}px`,
  minHeight: 0,
  maxHeight: '100%',
  alignSelf: 'flex-start',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: '0.65rem',
  border: '1px solid rgba(15, 23, 42, 0.1)',
  background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.62) 0%, rgba(240, 253, 250, 0.42) 100%)',
  backdropFilter: 'blur(6px)',
  transition: 'width 0.18s ease, flex-basis 0.18s ease, background 0.18s ease, border-color 0.18s ease',
};

export const mobileColumnStyle: React.CSSProperties = {
  ...columnStyle,
  width: `${KANBAN_MOBILE_COLUMN_VW}vw`,
  minWidth: `${KANBAN_MOBILE_COLUMN_MIN_PX}px`,
  maxWidth: `${KANBAN_MOBILE_COLUMN_MAX_PX}px`,
  flex: `0 0 ${KANBAN_MOBILE_COLUMN_VW}vw`,
};

export const singleColumnStyle: React.CSSProperties = {
  ...columnStyle,
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  flex: '0 0 100%',
};

export const collapsedColumnStyle: React.CSSProperties = {
  ...columnStyle,
  width: `${KANBAN_COLLAPSED_COLUMN_WIDTH_PX}px`,
  flex: `0 0 ${KANBAN_COLLAPSED_COLUMN_WIDTH_PX}px`,
  height: '100%',
  border: '1px solid rgba(14, 116, 144, 0.22)',
  background:
    'linear-gradient(180deg, rgba(236, 253, 245, 0.52) 0%, rgba(240, 249, 255, 0.22) 30%, rgba(255, 255, 255, 0) 100%)',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.28)',
  opacity: 0.52,
  overflow: 'hidden',
};

export const mobileCollapsedColumnStyle: React.CSSProperties = {
  ...collapsedColumnStyle,
  width: `${KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX}px`,
  minWidth: `${KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX}px`,
  maxWidth: `${KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX}px`,
  flex: `0 0 ${KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX}px`,
};

export const addAgentColumnStyle: React.CSSProperties = {
  ...columnStyle,
  borderStyle: 'dashed',
  borderColor: 'rgba(14, 116, 144, 0.35)',
  background: 'linear-gradient(155deg, rgba(224, 242, 254, 0.5) 0%, rgba(236, 253, 245, 0.45) 100%)',
};

export const mobileAddAgentColumnStyle: React.CSSProperties = {
  ...mobileColumnStyle,
  borderStyle: 'dashed',
  borderColor: 'rgba(14, 116, 144, 0.35)',
  background: 'linear-gradient(155deg, rgba(224, 242, 254, 0.5) 0%, rgba(236, 253, 245, 0.45) 100%)',
};

export const columnHeaderStyle: React.CSSProperties = {
  minHeight: '3.25rem',
  padding: '0.72rem 0.75rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderBottomColor: 'rgba(148, 163, 184, 0.3)',
  borderRadius: '0.8rem 0.8rem 0 0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.9) 100%)',
  boxShadow: '0 10px 24px -22px rgba(15, 23, 42, 0.5), inset 0 -1px 0 rgba(255, 255, 255, 0.64)',
};

export const pendingConfirmationColumnHeaderStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.2)',
  borderBottomColor: 'rgba(14, 116, 144, 0.24)',
  borderRadius: '0.8rem 0.8rem 0 0',
  background: 'linear-gradient(180deg, rgba(240, 249, 255, 0.98) 0%, rgba(236, 253, 245, 0.88) 100%)',
  boxShadow: '0 10px 28px -22px rgba(14, 116, 144, 0.7), inset 0 -1px 0 rgba(255, 255, 255, 0.72)',
};

export const columnTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  fontWeight: 700,
};

export const columnTitleRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.38rem',
  minWidth: 0,
};

export const columnCountStyle: React.CSSProperties = {
  minWidth: '1.45rem',
  height: '1.45rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  background: 'rgba(15, 118, 110, 0.1)',
  color: '#0f766e',
  fontSize: '0.74rem',
  fontWeight: 700,
};

export const columnHeaderActionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.42rem',
};

export const pendingConfirmationCreateButtonStyle: React.CSSProperties = {
  width: '1.6rem',
  minWidth: '1.6rem',
  height: '1.6rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid rgba(14, 116, 144, 0.28)',
  borderRadius: '999px',
  background: 'linear-gradient(180deg, rgba(14, 165, 233, 0.14) 0%, rgba(16, 185, 129, 0.12) 100%)',
  boxShadow: '0 8px 18px -14px rgba(14, 116, 144, 0.8)',
  color: '#0f766e',
  fontSize: '0.95rem',
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

export const interruptFlowButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(180, 83, 9, 0.28)',
  background: 'rgba(255, 247, 237, 0.94)',
  color: '#9a3412',
  borderRadius: '0.32rem',
  padding: '0.16rem 0.44rem',
  fontSize: '0.67rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const continueFlowButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.28)',
  background: 'rgba(240, 249, 255, 0.94)',
  color: '#0c4a6e',
  borderRadius: '0.32rem',
  padding: '0.16rem 0.44rem',
  fontSize: '0.67rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const runFlowButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 118, 110, 0.28)',
  background: 'rgba(236, 253, 245, 0.94)',
  color: '#0f766e',
  borderRadius: '0.32rem',
  padding: '0.16rem 0.44rem',
  fontSize: '0.67rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const flowColumnStatePillStyle: React.CSSProperties = {
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(248, 250, 252, 0.86)',
  color: '#334155',
  padding: '0.08rem 0.42rem',
  fontSize: '0.66rem',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

export const columnBodyStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.48rem',
  padding: '0.58rem',
};

export const collapsedColumnBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 0,
  overflow: 'hidden',
};

export const mobileColumnBodyStyle: React.CSSProperties = {
  ...columnBodyStyle,
  WebkitOverflowScrolling: 'touch',
};

export const addAgentBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'center',
  gap: '0.55rem',
};

export const mobileAddAgentBodyStyle: React.CSSProperties = {
  ...addAgentBodyStyle,
  minHeight: 'auto',
  paddingBottom: '0.9rem',
};

export const addAgentHintStyle: React.CSSProperties = {
  margin: '0.4rem 0 0',
  fontSize: '0.75rem',
  color: '#64748b',
  textAlign: 'center',
};

export const addAgentHeaderButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.35)',
  background: 'rgba(240, 249, 255, 0.95)',
  color: '#0c4a6e',
  borderRadius: '0.35rem',
  padding: '0.2rem 0.5rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
};

export const taskCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.76)',
  borderRadius: '0.55rem',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
};

export const taskCardButtonStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  borderRadius: '0.55rem',
  padding: '0.55rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  textAlign: 'left',
  cursor: 'pointer',
};

export const taskCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

export const taskSourceTagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  background: 'rgba(14, 116, 144, 0.12)',
  color: '#155e75',
  fontSize: '0.68rem',
  padding: '0.12rem 0.45rem',
  fontWeight: 700,
};

export const taskStatusTextStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#334155',
  fontWeight: 600,
};

export const taskTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.83rem',
  fontWeight: 700,
};

export const taskSummaryStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
  lineHeight: 1.35,
};

export const taskMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.71rem',
  color: '#64748b',
};

export const taskArtifactStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.7rem',
  color: '#334155',
  borderTop: '1px dashed rgba(148, 163, 184, 0.35)',
  paddingTop: '0.3rem',
};

export const errorPanelStyle: React.CSSProperties = {
  borderRadius: '0.55rem',
  border: '1px solid rgba(220, 38, 38, 0.35)',
  background: 'rgba(254, 242, 242, 0.86)',
  color: '#991b1b',
  padding: '0.55rem 0.65rem',
};

export const errorTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
};

export const errorMessageStyle: React.CSSProperties = {
  margin: '0.2rem 0 0 0',
  fontSize: '0.74rem',
};

export const emptyTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#64748b',
};

export const collapsedColumnTopStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  paddingTop: '0.38rem',
  paddingBottom: '0.22rem',
};

export const collapsedColumnTopPlaceholderStyle: React.CSSProperties = {
  margin: 0,
  color: 'rgba(8, 145, 178, 0.78)',
  fontSize: '0.88rem',
  fontWeight: 800,
  letterSpacing: '0.12em',
  lineHeight: 1,
  writingMode: 'vertical-rl',
  textOrientation: 'mixed',
  userSelect: 'none',
};

export const collapsedColumnFadeStyle: React.CSSProperties = {
  width: '100%',
  flex: 1,
  background:
    'linear-gradient(180deg, rgba(45, 212, 191, 0.14) 0%, rgba(45, 212, 191, 0.06) 28%, rgba(255, 255, 255, 0) 100%)',
};
