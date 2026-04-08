import { describe, expect, it } from 'vitest';

import type { FlowChatMessageItem } from '../api/types';
import {
  cachePlannerMessagesBySession,
  readPlannerMessagesFromCache,
} from './flowPlannerMessageCache';

function message(content: string): FlowChatMessageItem {
  return {
    role: 'assistant',
    content,
    created_at: '2026-04-07T00:00:00Z',
  };
}

describe('flowPlannerMessageCache', () => {
  it('stores latest messages and trims by max message count', () => {
    const messagesBySession: Record<string, FlowChatMessageItem[]> = {};
    const seenAtBySession: Record<string, number> = {};
    cachePlannerMessagesBySession({
      messagesBySession,
      seenAtBySession,
      sessionKey: 'session-a',
      messages: [message('1'), message('2'), message('3')],
      nowMs: 100,
      maxMessages: 2,
      maxSessions: 8,
    });

    expect(messagesBySession['session-a']?.map((item) => item.content)).toEqual(['2', '3']);
    expect(seenAtBySession['session-a']).toBe(100);
  });

  it('evicts oldest sessions when exceeding max session count', () => {
    const messagesBySession: Record<string, FlowChatMessageItem[]> = {
      'session-old': [message('old')],
      'session-keep': [message('keep')],
    };
    const seenAtBySession: Record<string, number> = {
      'session-old': 10,
      'session-keep': 20,
    };

    cachePlannerMessagesBySession({
      messagesBySession,
      seenAtBySession,
      sessionKey: 'session-new',
      messages: [message('new')],
      nowMs: 30,
      maxMessages: 10,
      maxSessions: 2,
    });

    expect(Object.keys(messagesBySession).sort()).toEqual(['session-keep', 'session-new']);
    expect(messagesBySession['session-old']).toBeUndefined();
    expect(seenAtBySession['session-old']).toBeUndefined();
  });

  it('reads cache with normalized session key and handles missing key', () => {
    const messagesBySession: Record<string, FlowChatMessageItem[]> = {
      'session-a': [message('hello')],
    };

    expect(readPlannerMessagesFromCache(messagesBySession, ' session-a ')).toEqual([message('hello')]);
    expect(readPlannerMessagesFromCache(messagesBySession, '')).toEqual([]);
    expect(readPlannerMessagesFromCache(messagesBySession, 'missing')).toEqual([]);
  });
});
