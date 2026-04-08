import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SessionPreviewItem } from '../api/types';
import type { BoardTask } from './kanbanTypes';
import {
  CollabTaskDetailModal,
  type CollabTaskDetailModalStyles,
  type TaskDetailTab,
} from './collabTaskDetailModal';

function buildTask(partial: Partial<BoardTask> = {}): BoardTask {
  return {
    id: partial.id ?? 'task-1',
    title: partial.title ?? '任务1',
    summary: partial.summary ?? '摘要',
    status: partial.status ?? 'queued',
    source: partial.source ?? 'flow',
    instanceId: partial.instanceId ?? 'inst-1',
    agentId: partial.agentId ?? 'agent-1',
    agentName: partial.agentName ?? 'Agent 1',
    artifacts: partial.artifacts ?? [],
    extras: partial.extras ?? {},
  };
}

function renderModal(tab: TaskDetailTab, options?: {
  task?: BoardTask;
  sessionItems?: SessionPreviewItem[];
}) {
  const onTaskDetailTabChange = vi.fn();
  const onInterruptSelectedTask = vi.fn();
  const onContinueSelectedTask = vi.fn();
  const onDeleteTaskNode = vi.fn();
  const onSelectOutputEntryId = vi.fn();
  const styles = new Proxy({}, { get: () => ({}) }) as CollabTaskDetailModalStyles;

  render(
    <CollabTaskDetailModal
      isMobile={false}
      boardRealtimeId="default"
      selectedTask={options?.task ?? buildTask()}
      taskDetailTab={tab}
      onTaskDetailTabChange={onTaskDetailTabChange}
      onClose={() => {}}
      dependencyEntries={[]}
      canInterruptSelectedTask
      canContinueSelectedTask
      isInterruptingTaskId={null}
      isContinuingTaskId={null}
      onInterruptSelectedTask={onInterruptSelectedTask}
      onContinueSelectedTask={onContinueSelectedTask}
      onDeleteTaskNode={onDeleteTaskNode}
      formatTaskAgentLabel={(task) => task.agentName}
      getTaskExecutionSessionKey={() => 'session-1'}
      outputEntries={[{ id: 'file:/tmp/a.txt', title: '文件A', value: '/tmp/a.txt' }]}
      selectedOutputEntry={{ id: 'file:/tmp/a.txt', title: '文件A', value: '/tmp/a.txt' }}
      onSelectOutputEntryId={onSelectOutputEntryId}
      selectedOutputFileInlineUrl="about:blank"
      isOutputPreviewLoading={false}
      outputPreviewError={null}
      outputPreview={{
        path: '/tmp/a.txt',
        kind: 'text',
        mime_type: 'text/plain',
        size_bytes: 5,
        truncated: false,
        content: 'hello',
        download_url: 'about:blank',
      }}
      isTaskSessionLoading={false}
      taskSessionError={null}
      taskSessionItems={options?.sessionItems ?? []}
      taskSessionListRef={createRef<HTMLDivElement>()}
      styles={styles}
    />
  );

  return {
    onTaskDetailTabChange,
    onInterruptSelectedTask,
    onContinueSelectedTask,
    onDeleteTaskNode,
    onSelectOutputEntryId,
  };
}

describe('collabTaskDetailModal', () => {
  it('switches tabs through callbacks', async () => {
    const user = userEvent.setup();
    const { onTaskDetailTabChange } = renderModal('info');
    await user.click(screen.getByRole('tab', { name: '执行流程' }));
    await user.click(screen.getByRole('tab', { name: '任务产出' }));
    expect(onTaskDetailTabChange).toHaveBeenCalledWith('stream');
    expect(onTaskDetailTabChange).toHaveBeenCalledWith('output');
  });

  it('triggers interrupt action for running task', async () => {
    const user = userEvent.setup();
    const { onInterruptSelectedTask } = renderModal('info', {
      task: buildTask({ status: 'running' }),
    });
    await user.click(screen.getByRole('button', { name: '中断' }));
    expect(onInterruptSelectedTask).toHaveBeenCalledTimes(1);
  });

  it('renders stream messages', () => {
    renderModal('stream', {
      sessionItems: [
        { role: 'user', text: 'hello' },
      ],
    });
    expect(screen.getByText('执行消息流')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
