import type { SessionPreviewItem } from '../api/types';

export function getCompactLabel(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export function mergeStreamingAssistantText(previousText: string, incomingText: string): string {
  if (!incomingText) return previousText;
  if (!previousText) return incomingText;
  if (incomingText.startsWith(previousText)) return incomingText;
  if (previousText.startsWith(incomingText)) return previousText;
  if (previousText.endsWith(incomingText)) return previousText;
  return `${previousText}${incomingText}`;
}

export function mergePreviewItemsFromRealtime(
  previousItems: SessionPreviewItem[],
  incomingItems: SessionPreviewItem[]
): SessionPreviewItem[] {
  if (incomingItems.length === 0) return previousItems;
  if (!(incomingItems.length === 1 && incomingItems[0].role === 'assistant')) {
    return incomingItems;
  }
  if (previousItems.length === 0) return incomingItems;

  const lastIndex = previousItems.length - 1;
  const lastItem = previousItems[lastIndex];
  const incomingAssistantItem = incomingItems[0];
  if (lastItem.role !== 'assistant') {
    return [...previousItems, incomingAssistantItem];
  }

  const mergedText = mergeStreamingAssistantText(lastItem.text, incomingAssistantItem.text);
  if (mergedText === lastItem.text) {
    return previousItems;
  }
  return [
    ...previousItems.slice(0, lastIndex),
    { ...lastItem, text: mergedText },
  ];
}

export function arePreviewItemsEqual(
  previousItems: SessionPreviewItem[],
  nextItems: SessionPreviewItem[]
): boolean {
  if (previousItems === nextItems) return true;
  if (previousItems.length !== nextItems.length) return false;
  for (let index = 0; index < previousItems.length; index += 1) {
    const previous = previousItems[index];
    const next = nextItems[index];
    if (previous.role !== next.role || previous.text !== next.text) {
      return false;
    }
  }
  return true;
}

export function tryParseJsonValue(text: string): unknown | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

export function formatJsonPrimitive(value: string | number | boolean | null): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}

export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('video/');
}

export function isAudioMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('audio/');
}
