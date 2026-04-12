import type { CreateDirectoryOption } from './types';
import {
  actionButtonStyle,
  actionPrimaryButtonStyle,
  createDialogActionsStyle,
  createDialogCardStyle,
  createDialogInputStyle,
  createDialogLabelStyle,
  createDialogOverlayStyle,
  createDialogSelectStyle,
  createDialogTitleStyle,
} from './styles';

type InstanceFilesCreateDialogProps = {
  isOpen: boolean;
  isCreatingTaskFile: boolean;
  createTargetKey: string;
  createFileName: string;
  createDirectoryOptions: CreateDirectoryOption[];
  onClose: () => void;
  onTargetKeyChange: (value: string) => void;
  onFileNameChange: (value: string) => void;
  onCreate: () => Promise<void>;
};

export function InstanceFilesCreateDialog({
  isOpen,
  isCreatingTaskFile,
  createTargetKey,
  createFileName,
  createDirectoryOptions,
  onClose,
  onTargetKeyChange,
  onFileNameChange,
  onCreate,
}: InstanceFilesCreateDialogProps): JSX.Element | null {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新增任务文件"
      style={createDialogOverlayStyle}
      onClick={onClose}
    >
      <div style={createDialogCardStyle} onClick={(event) => event.stopPropagation()}>
        <h3 style={createDialogTitleStyle}>新增任务文件</h3>
        <label style={createDialogLabelStyle}>
          目录
          <select
            value={createTargetKey}
            onChange={(event) => onTargetKeyChange(event.target.value)}
            style={createDialogSelectStyle}
            aria-label="新文件目录"
            disabled={isCreatingTaskFile}
          >
            {createDirectoryOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label style={createDialogLabelStyle}>
          文件名
          <input
            value={createFileName}
            onChange={(event) => onFileNameChange(event.target.value)}
            placeholder="例如 notes.md"
            style={createDialogInputStyle}
            aria-label="新文件名"
            disabled={isCreatingTaskFile}
          />
        </label>
        <div style={createDialogActionsStyle}>
          <button type="button" style={actionButtonStyle} onClick={onClose} disabled={isCreatingTaskFile}>
            取消
          </button>
          <button
            type="button"
            style={actionPrimaryButtonStyle}
            onClick={() => {
              void onCreate();
            }}
            disabled={isCreatingTaskFile || !createTargetKey}
          >
            {isCreatingTaskFile ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
