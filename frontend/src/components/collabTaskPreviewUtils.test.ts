import { describe, expect, it } from 'vitest';

import type { SessionPreviewItem } from '../api/types';
import {
  arePreviewItemsEqual,
  formatJsonPrimitive,
  getCompactLabel,
  isAudioMimeType,
  isImageMimeType,
  isPdfMimeType,
  isVideoMimeType,
  mergePreviewItemsFromRealtime,
  tryParseJsonValue,
} from './collabTaskPreviewUtils';

function makeItem(role: SessionPreviewItem['role'], text: string): SessionPreviewItem {
  return { role, text };
}

describe('collabTaskPreviewUtils', () => {
  it('compacts long labels and preserves short labels', () => {
    expect(getCompactLabel('  abc   def ', 20)).toBe('abc def');
    expect(getCompactLabel('abcdefghijklmnopqrstuvwxyz', 8)).toBe('abcdefgh...');
  });

  it('merges streaming assistant text incrementally', () => {
    const previous = [makeItem('assistant', 'hello')];
    const incoming = [makeItem('assistant', 'hello world')];
    expect(mergePreviewItemsFromRealtime(previous, incoming)).toEqual([makeItem('assistant', 'hello world')]);
  });

  it('compares preview items by role and text', () => {
    expect(arePreviewItemsEqual([makeItem('user', 'a')], [makeItem('user', 'a')])).toBe(true);
    expect(arePreviewItemsEqual([makeItem('user', 'a')], [makeItem('assistant', 'a')])).toBe(false);
  });

  it('parses json and formats primitives', () => {
    expect(tryParseJsonValue('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJsonValue('')).toBeNull();
    expect(formatJsonPrimitive(null)).toBe('null');
    expect(formatJsonPrimitive('x')).toBe('"x"');
    expect(formatJsonPrimitive(1)).toBe('1');
  });

  it('detects supported preview mime types', () => {
    expect(isImageMimeType('image/png')).toBe(true);
    expect(isPdfMimeType('application/pdf')).toBe(true);
    expect(isVideoMimeType('video/mp4')).toBe(true);
    expect(isAudioMimeType('audio/mpeg')).toBe(true);
  });
});
