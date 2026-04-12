import { beforeEach, describe, expect, it } from 'vitest';

import {
  areFlowIdOrdersEqual,
  clearFlowSidebarOrder,
  dedupeFlowIds,
  loadFlowSidebarOrder,
  moveFlowIdInOrder,
  saveFlowSidebarOrder,
} from './flowSidebarOrderStore';

describe('flowSidebarOrderStore', () => {
  beforeEach(() => {
    clearFlowSidebarOrder();
  });

  it('dedupes flow ids with trim and stable order', () => {
    expect(dedupeFlowIds([' flow-a ', 'flow-b', 'flow-a', '', 'flow-b', 'flow-c'])).toEqual([
      'flow-a',
      'flow-b',
      'flow-c',
    ]);
  });

  it('loads and saves deduped order from localStorage', () => {
    saveFlowSidebarOrder(['flow-a', 'flow-a', ' flow-b ']);
    expect(loadFlowSidebarOrder()).toEqual(['flow-a', 'flow-b']);
  });

  it('returns empty order before first save', () => {
    expect(loadFlowSidebarOrder()).toEqual([]);
  });

  it('checks order equality by exact sequence', () => {
    expect(areFlowIdOrdersEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(areFlowIdOrdersEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(areFlowIdOrdersEqual(['a'], ['a', 'b'])).toBe(false);
  });

  it('moves a source flow id before target id and keeps deduped order', () => {
    expect(moveFlowIdInOrder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveFlowIdInOrder(['a', 'a', 'b', 'c'], 'b', 'c')).toEqual(['a', 'b', 'c']);
    expect(moveFlowIdInOrder(['a', 'b', 'c'], 'x', 'a')).toEqual(['a', 'b', 'c']);
  });
});
