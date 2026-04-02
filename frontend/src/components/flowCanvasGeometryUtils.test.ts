import { describe, expect, it } from 'vitest';

import type { FlowCanvasEdge } from '../api/types';
import {
  buildConnectorCurvePath,
  buildEdgeRenderMetas,
  resolveShortestConnectorPair,
  toCanvasPoint,
} from './flowCanvasGeometryUtils';
import type { NodeRenderLayout } from './flowPageStateUtils';

function parsePathNumbers(path: string): number[] {
  return path
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map((value) => Number(value)) ?? [];
}

describe('flowCanvasGeometryUtils', () => {
  it('converts client coordinates to canvas coordinates using viewport offset and scroll', () => {
    const viewport = {
      scrollLeft: 16,
      scrollTop: 24,
      getBoundingClientRect: () => ({
        left: 120,
        top: 80,
      }),
    } as unknown as HTMLDivElement;

    expect(toCanvasPoint(viewport, 200, 190)).toEqual({ x: 96, y: 134 });
  });

  it('gracefully handles non-finite viewport metrics and client values', () => {
    const viewport = {
      scrollLeft: Number.NaN,
      scrollTop: Number.NaN,
      getBoundingClientRect: () => ({
        left: Number.NaN,
        top: Number.POSITIVE_INFINITY,
      }),
    } as unknown as HTMLDivElement;

    expect(toCanvasPoint(viewport, 30, 40)).toEqual({ x: 30, y: 40 });
    expect(toCanvasPoint(viewport, Number.POSITIVE_INFINITY, 40)).toBeNull();
    expect(toCanvasPoint(null, 30, 40)).toBeNull();
  });

  it('builds connector curves with directional control points and minimum horizontal offset', () => {
    const forwardPath = buildConnectorCurvePath({ x: 0, y: 0 }, { x: 10, y: 5 });
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = parsePathNumbers(forwardPath);

    expect([sx, sy, tx, ty]).toEqual([0, 0, 10, 5]);
    expect(c1x).toBe(48);
    expect(c2x).toBe(-38);
    expect(c1x).toBeGreaterThan(sx);
    expect(c2x).toBeLessThan(tx);
    expect(c1y).toBeGreaterThan(sy);
    expect(c2y).toBeLessThan(ty);

    const reversePath = buildConnectorCurvePath({ x: 200, y: 80 }, { x: 20, y: 0 });
    const [rsx, rsy, rc1x, rc1y, rc2x, rc2y, rtx, rty] = parsePathNumbers(reversePath);

    expect([rsx, rsy, rtx, rty]).toEqual([200, 80, 20, 0]);
    expect(rc1x).toBeLessThan(rsx);
    expect(rc2x).toBeGreaterThan(rtx);
    expect(rc1y).toBeLessThan(rsy);
    expect(rc2y).toBeGreaterThan(rty);
  });

  it('builds edge render metas from available layouts and skips missing nodes', () => {
    const layoutA: NodeRenderLayout = { left: 0, top: 0, laneId: 'lane-a' };
    const layoutB: NodeRenderLayout = { left: 500, top: 0, laneId: 'lane-b' };
    const edges: FlowCanvasEdge[] = [
      { id: 'edge-a-b', source: 'a', target: 'b' },
      { id: 'edge-a-missing', source: 'a', target: 'missing' },
    ];

    const nodeLayoutMap = new Map<string, NodeRenderLayout>([
      ['a', layoutA],
      ['b', layoutB],
    ]);
    const pair = resolveShortestConnectorPair(layoutA, layoutB);

    expect(buildEdgeRenderMetas(edges, nodeLayoutMap)).toEqual([
      {
        id: 'edge-a-b',
        source: 'a',
        target: 'b',
        path: buildConnectorCurvePath(pair.source, pair.target),
        sourceSide: 'right',
        targetSide: 'left',
      },
    ]);
  });
});
