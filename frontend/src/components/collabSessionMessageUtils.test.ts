import { describe, expect, it } from 'vitest';

import {
  buildMessageSummary,
  getMessageHint,
  getRoleLabel,
  getTaskSessionItemStyle,
  shouldRenderCollapsibleMessage,
} from './collabSessionMessageUtils';

describe('collabSessionMessageUtils', () => {
  it('marks tool messages as collapsible and summarizes tool name', () => {
    const text = 'tool.call(weather.lookup) payload';
    expect(shouldRenderCollapsibleMessage('tool', text)).toBe(true);
    expect(buildMessageSummary('tool', text)).toBe('工具调用：weather.lookup');
  });

  it('returns callback-specific hint and label for structured callback payload', () => {
    const callbackPayload = JSON.stringify({
      accepted: true,
      task_id: 'task-1',
      run_id: 'run-1',
      status: 'ok',
    });
    expect(getMessageHint('other', callbackPayload)).toBe('回调响应详情');
    expect(getRoleLabel('other', callbackPayload)).toBe('回调响应');
  });

  it('returns data-output label for structured data payload', () => {
    const dataPayload = JSON.stringify({
      data_type: 'market_report',
      output_file_path: '/tmp/linpo/out.json',
    });
    expect(getRoleLabel('other', dataPayload)).toBe('数据输出');
  });

  it('returns role-based item style variants', () => {
    const assistantStyle = getTaskSessionItemStyle('assistant', 'ok');
    expect(assistantStyle.background).toBe('rgba(236, 253, 245, 0.9)');

    const toolErrorStyle = getTaskSessionItemStyle(
      'tool',
      JSON.stringify({ tool: 'search', status: 'error', error: 'failed' })
    );
    expect(toolErrorStyle.background).toBe('rgba(254, 242, 242, 0.9)');
  });
});
