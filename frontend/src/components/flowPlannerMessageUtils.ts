import type { FlowChatMessageItem } from '../api/types';

export type PlannerMessageRealtimeSource = 'sse';

export type PlannerMessageRealtimeWriteState = {
  lastSeq: number | null;
};

type ResolvePlannerMessageRealtimeWriteIntentParams = {
  currentState: PlannerMessageRealtimeWriteState | undefined;
  seq: number;
};

type PlannerMessageRealtimeWriteIgnoreResult = {
  kind: 'ignore';
  nextState: PlannerMessageRealtimeWriteState;
};

type PlannerMessageRealtimeWriteApplyResult = {
  kind: 'apply';
  nextState: PlannerMessageRealtimeWriteState;
};

type ResolvePlannerMessageRealtimeWriteIntentResult =
  | PlannerMessageRealtimeWriteIgnoreResult
  | PlannerMessageRealtimeWriteApplyResult;

export type PlannerMessageRealtimeApplyResult =
  | { kind: 'applied' }
  | { kind: 'ignored' };

type ResolvePlannerMessageRealtimeUpdateParams = {
  currentState: PlannerMessageRealtimeWriteState | undefined;
  previousMessages: FlowChatMessageItem[];
  incomingMessages: FlowChatMessageItem[];
  seq: number;
  updateMode?: 'replace' | 'append_chunk';
};

export type ResolvePlannerMessageRealtimeUpdateResult = {
  applyResult: PlannerMessageRealtimeApplyResult;
  nextState: PlannerMessageRealtimeWriteState;
  nextMessages: FlowChatMessageItem[];
};

const DEFAULT_REALTIME_WRITE_STATE: PlannerMessageRealtimeWriteState = {
  lastSeq: null,
};

export function hasPendingPlannerReply(messages: FlowChatMessageItem[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    return message.role === 'user';
  }
  return false;
}

export function sanitizePlannerMessages(messages: FlowChatMessageItem[]): FlowChatMessageItem[] {
  return messages.map((item) => sanitizePlannerMessage(item));
}

export function mergeStreamingPlannerAssistantText(previousText: string, incomingText: string): string {
  if (!incomingText) return previousText;
  if (!previousText) return incomingText;
  if (incomingText.startsWith(previousText)) return incomingText;
  if (previousText.startsWith(incomingText)) return previousText;
  if (previousText.endsWith(incomingText)) return previousText;
  return `${previousText}${incomingText}`;
}

export function mergeFlowChatMessagesFromRealtime(params: {
  previousMessages: FlowChatMessageItem[];
  incomingMessages: FlowChatMessageItem[];
  updateMode?: 'replace' | 'append_chunk';
}): FlowChatMessageItem[] {
  const { previousMessages, incomingMessages, updateMode } = params;
  if (updateMode !== 'append_chunk') {
    // 保护本地“待回复”用户消息：后端偶发返回空 replace 快照时，不应把正在进行中的请求痕迹清空。
    if (incomingMessages.length === 0 && hasPendingPlannerReply(previousMessages)) {
      return previousMessages;
    }
    return incomingMessages;
  }
  if (incomingMessages.length === 0) {
    return previousMessages;
  }
  if (!(incomingMessages.length === 1 && shouldMergeAssistantChunk(incomingMessages[0]))) {
    return incomingMessages;
  }
  if (previousMessages.length === 0) {
    return incomingMessages;
  }

  const lastIndex = previousMessages.length - 1;
  const lastMessage = previousMessages[lastIndex];
  const incomingAssistant = incomingMessages[0];
  if (!lastMessage || !shouldMergeAssistantChunk(lastMessage)) {
    return [...previousMessages, incomingAssistant];
  }

  const mergedContent = mergeStreamingPlannerAssistantText(
    String(lastMessage.content ?? ''),
    String(incomingAssistant.content ?? '')
  );
  if (mergedContent === String(lastMessage.content ?? '')) {
    return previousMessages;
  }
  return [
    ...previousMessages.slice(0, lastIndex),
    {
      ...lastMessage,
      content: mergedContent,
      kind: incomingAssistant.kind ?? lastMessage.kind,
      payload: incomingAssistant.payload ?? lastMessage.payload,
      created_at: incomingAssistant.created_at || lastMessage.created_at,
    },
  ];
}

export function resolvePlannerMessageRealtimeWriteIntent(
  params: ResolvePlannerMessageRealtimeWriteIntentParams
): ResolvePlannerMessageRealtimeWriteIntentResult {
  const currentState = params.currentState ?? DEFAULT_REALTIME_WRITE_STATE;
  const normalizedSeq = Number.isFinite(params.seq) ? Math.trunc(params.seq) : -1;
  const previousSeq = currentState.lastSeq;
  if (typeof previousSeq === 'number' && normalizedSeq <= previousSeq) {
    return {
      kind: 'ignore',
      nextState: currentState,
    };
  }
  return {
    kind: 'apply',
    nextState: {
      lastSeq: normalizedSeq,
    },
  };
}

export function resolvePlannerMessageRealtimeUpdate(
  params: ResolvePlannerMessageRealtimeUpdateParams
): ResolvePlannerMessageRealtimeUpdateResult {
  const writeIntent = resolvePlannerMessageRealtimeWriteIntent({
    currentState: params.currentState,
    seq: params.seq,
  });
  if (writeIntent.kind === 'ignore') {
    return {
      applyResult: { kind: 'ignored' },
      nextState: writeIntent.nextState,
      nextMessages: params.previousMessages,
    };
  }

  const nextMessages = mergeSanitizedPlannerMessagesFromRealtime({
    previousMessages: params.previousMessages,
    incomingMessages: params.incomingMessages,
    updateMode: params.updateMode,
  });
  return {
    applyResult: nextMessages === params.previousMessages ? { kind: 'ignored' } : { kind: 'applied' },
    nextState: writeIntent.nextState,
    nextMessages,
  };
}

export function mergeSanitizedPlannerMessagesFromRealtime(params: {
  previousMessages: FlowChatMessageItem[];
  incomingMessages: FlowChatMessageItem[];
  updateMode?: 'replace' | 'append_chunk';
}): FlowChatMessageItem[] {
  const sanitizedIncomingMessages = sanitizePlannerMessages(params.incomingMessages);
  return mergeFlowChatMessagesFromRealtime({
    previousMessages: params.previousMessages,
    incomingMessages: sanitizedIncomingMessages,
    updateMode: params.updateMode,
  });
}

export function normalizePlannerObserverMessageRole(role: string): FlowChatMessageItem['role'] {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  return 'system';
}

export function normalizePlannerObserverMessageKind(params: {
  role: string;
  kind?: string;
}): string | undefined {
  const normalizedKind = String(params.kind ?? '').trim();
  if (normalizedKind) {
    return normalizedKind;
  }
  if (params.role === 'tool') {
    return 'tool_call';
  }
  return undefined;
}

function sanitizePlannerMessage(message: FlowChatMessageItem): FlowChatMessageItem {
  const roleValue = String(message.role ?? '').trim();
  const role: FlowChatMessageItem['role'] =
    roleValue === 'user' || roleValue === 'assistant' || roleValue === 'system'
      ? roleValue
      : 'system';
  const kindValue = String(message.kind ?? '').trim();
  const payloadValue = normalizeMessagePayload(message.payload);
  const normalizedMessage: FlowChatMessageItem = {
    role,
    content: String(message.content ?? ''),
    created_at: String(message.created_at ?? ''),
  };
  if (kindValue) {
    normalizedMessage.kind = kindValue;
  }
  if (payloadValue) {
    normalizedMessage.payload = payloadValue;
  }
  return normalizedMessage;
}

function shouldMergeAssistantChunk(message: FlowChatMessageItem | undefined): boolean {
  if (!message) {
    return false;
  }
  if (message.role !== 'assistant') {
    return false;
  }
  const kind = String(message.kind ?? 'message').trim() || 'message';
  return kind === 'message' || kind === 'assistant_delta';
}

function normalizeMessagePayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  return payload as Record<string, unknown>;
}
