import type { BoardViewMode } from '../kanbanTypes';
import type { BoardColumn } from '../collabKanbanColumnsUtils';
import {
  mobileBoardMenuCardStyle,
  mobileBoardMenuCloseStyle,
  mobileBoardMenuFieldStyle,
  mobileBoardMenuHeaderStyle,
  mobileBoardMenuLabelStyle,
  mobileBoardMenuOverlayStyle,
  mobileBoardMenuStatsStyle,
  mobileBoardMenuTitleStyle,
  statsItemStyle,
  viewSelectMobileStyle,
  viewSelectStyle,
} from './styles';

type CollabMobileBoardMenuProps = {
  open: boolean;
  requirementCount: number;
  currentMobileColumnIndex: number;
  columns: BoardColumn[];
  viewMode: BoardViewMode;
  onClose: () => void;
  onViewModeChange: (mode: BoardViewMode) => void;
  onColumnIndexChange: (index: number) => void;
};

export function CollabMobileBoardMenu(props: CollabMobileBoardMenuProps): JSX.Element | null {
  const {
    open,
    requirementCount,
    currentMobileColumnIndex,
    columns,
    viewMode,
    onClose,
    onViewModeChange,
    onColumnIndexChange,
  } = props;

  if (!open) {
    return null;
  }

  // 边界说明：该组件仅封装移动端看板菜单的展示与事件透传，
  // 具体状态更新由父组件控制，避免在子组件内引入业务状态分叉。
  return (
    <div
      style={mobileBoardMenuOverlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label="看板菜单"
      onClick={onClose}
    >
      <div style={mobileBoardMenuCardStyle} onClick={(event) => event.stopPropagation()}>
        <div style={mobileBoardMenuHeaderStyle}>
          <h3 style={mobileBoardMenuTitleStyle}>看板菜单</h3>
          <button type="button" style={mobileBoardMenuCloseStyle} onClick={onClose}>
            关闭
          </button>
        </div>
        <div style={mobileBoardMenuStatsStyle}>
          <span style={statsItemStyle}>流程数量 {requirementCount}</span>
          {columns.length > 0 ? (
            <span style={statsItemStyle}>当前列 {currentMobileColumnIndex + 1} / {columns.length}</span>
          ) : null}
        </div>
        <label style={mobileBoardMenuFieldStyle}>
          <span style={mobileBoardMenuLabelStyle}>分列方式</span>
          <select
            aria-label="分列方式"
            value={viewMode}
            onChange={(event) => onViewModeChange(event.target.value as BoardViewMode)}
            style={{ ...viewSelectStyle, ...viewSelectMobileStyle }}
          >
            <option value="status">按状态分列</option>
            <option value="agent">按 Agent 分列</option>
            <option value="flow">按流程分列</option>
          </select>
        </label>
        <label style={mobileBoardMenuFieldStyle}>
          <span style={mobileBoardMenuLabelStyle}>查看列</span>
          <select
            aria-label="查看列"
            value={String(currentMobileColumnIndex)}
            onChange={(event) => {
              const nextIndex = Number.parseInt(event.target.value, 10);
              onColumnIndexChange(Number.isFinite(nextIndex) ? Math.max(0, nextIndex) : 0);
            }}
            style={{ ...viewSelectStyle, ...viewSelectMobileStyle }}
            disabled={columns.length === 0}
          >
            {columns.length === 0 ? <option value="0">暂无列</option> : null}
            {columns.map((column, index) => (
              <option key={column.id} value={String(index)}>
                {column.title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
