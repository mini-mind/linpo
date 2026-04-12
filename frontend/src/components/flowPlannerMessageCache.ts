import type { FlowChatMessageItem } from '../api/types';

type CacheParams = {
  messagesBySession: Record<string, FlowChatMessageItem[]>;
  seenAtBySession: Record<string, number>;
  sessionKey: string | null | undefined;
  messages: FlowChatMessageItem[];
  nowMs: number;
  maxMessages: number;
  maxSessions: number;
};

function normalizeSessionKey(sessionKey: string | null | undefined): string {
  return sessionKey?.trim() ?? '';
}

export function cachePlannerMessagesBySession(params: CacheParams): void {
  const {
    messagesBySession,
    seenAtBySession,
    sessionKey,
    messages,
    nowMs,
    maxMessages,
    maxSessions,
  } = params;
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  if (!normalizedSessionKey) {
    return;
  }

  messagesBySession[normalizedSessionKey] = messages.slice(-maxMessages);
  seenAtBySession[normalizedSessionKey] = nowMs;

  const cachedSessionKeys = Object.keys(messagesBySession);
  if (cachedSessionKeys.length <= maxSessions) {
    return;
  }
  const keysByOldest = [...cachedSessionKeys].sort(
    (left, right) => (seenAtBySession[left] ?? 0) - (seenAtBySession[right] ?? 0)
  );
  const staleCount = cachedSessionKeys.length - maxSessions;
  for (let index = 0; index < staleCount; index += 1) {
    const staleKey = keysByOldest[index];
    delete messagesBySession[staleKey];
    delete seenAtBySession[staleKey];
  }
}

export function readPlannerMessagesFromCache(
  messagesBySession: Record<string, FlowChatMessageItem[]>,
  sessionKey: string | null | undefined
): FlowChatMessageItem[] {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  if (!normalizedSessionKey) {
    return [];
  }
  return messagesBySession[normalizedSessionKey] ?? [];
}
