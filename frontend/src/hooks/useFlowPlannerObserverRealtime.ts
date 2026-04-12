import { useEffect } from 'react';

import type { FlowChatMessageItem } from '../api/types';
import type { PlannerRealtimeMessageHandleResult } from './useFlowPlannerRealtime';

type UseFlowPlannerObserverRealtimeOptions = {
  sessionKey: string | null;
  sessionInstanceId: string | null;
  enabled?: boolean;
  onMessagesUpdated: (params: {
    sessionKey: string;
    seq: number;
    updateMode?: 'replace' | 'append_chunk';
    messages: FlowChatMessageItem[];
  }) => PlannerRealtimeMessageHandleResult;
};

// 单源重构：planner 消息仅允许 SSE 链路写入，observer 消息写入路径永久禁用。
export function useFlowPlannerObserverRealtime(_options: UseFlowPlannerObserverRealtimeOptions): void {
  useEffect(() => {
    // 显式 no-op，避免后续误接回 observer 写入通道。
  }, []);
}
