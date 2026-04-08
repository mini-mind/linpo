const FLOW_SIDEBAR_ORDER_STORAGE_KEY = 'linpo.flow_sidebar_order_v1';

export function loadFlowSidebarOrder(): string[] {
  try {
    const raw = window.localStorage.getItem(FLOW_SIDEBAR_ORDER_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return dedupeFlowIds(parsed.map((item) => String(item ?? '').trim()).filter((item) => item !== ''));
  } catch {
    return [];
  }
}

export function saveFlowSidebarOrder(order: string[]): void {
  try {
    window.localStorage.setItem(FLOW_SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(dedupeFlowIds(order)));
  } catch {
    // ignore storage failures
  }
}

export function dedupeFlowIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of ids) {
    const normalized = String(item ?? '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

export function areFlowIdOrdersEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function moveFlowIdInOrder(currentOrder: string[], sourceId: string, targetId: string): string[] {
  const normalizedSourceId = sourceId.trim();
  const normalizedTargetId = targetId.trim();
  if (!normalizedSourceId || !normalizedTargetId || normalizedSourceId === normalizedTargetId) {
    return currentOrder;
  }
  const deduped = dedupeFlowIds(currentOrder);
  const sourceIndex = deduped.indexOf(normalizedSourceId);
  const targetIndex = deduped.indexOf(normalizedTargetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return deduped;
  }
  const next = [...deduped];
  const [sourceValue] = next.splice(sourceIndex, 1);
  const insertIndex = next.indexOf(normalizedTargetId);
  next.splice(insertIndex < 0 ? next.length : insertIndex, 0, sourceValue);
  return next;
}
