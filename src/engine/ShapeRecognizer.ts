import { Point, ShapeData, ShapeType } from '../types';

/**
 * Recognizes hand-drawn shapes and snaps them to perfect geometry.
 * Uses simple heuristics: circularity, linearity, rectangularity.
 */
export class ShapeRecognizer {
  private static readonly LINE_THRESHOLD = 0.95;
  private static readonly CIRCLE_THRESHOLD = 0.85;
  private static readonly RECT_THRESHOLD = 0.80;

  /**
   * Attempt to recognize a shape from freehand points.
   * Returns null if no shape is confidently detected.
   */
  static recognize(points: Point[]): ShapeData | null {
    if (points.length < 5) return null;

    // Try line first (simplest)
    const lineScore = ShapeRecognizer.lineScore(points);
    if (lineScore > ShapeRecognizer.LINE_THRESHOLD) {
      return ShapeRecognizer.snapToLine(points);
    }

    // Try circle
    const circleResult = ShapeRecognizer.circleScore(points);
    if (circleResult.score > ShapeRecognizer.CIRCLE_THRESHOLD) {
      return {
        type: 'circle',
        startX: circleResult.cx - circleResult.radius,
        startY: circleResult.cy - circleResult.radius,
        endX: circleResult.cx + circleResult.radius,
        endY: circleResult.cy + circleResult.radius,
        cx: circleResult.cx,
        cy: circleResult.cy,
        radius: circleResult.radius,
      };
    }

    // Try rectangle
    const rectScore = ShapeRecognizer.rectangleScore(points);
    if (rectScore.score > ShapeRecognizer.RECT_THRESHOLD) {
      return {
        type: 'rectangle',
        startX: rectScore.minX,
        startY: rectScore.minY,
        endX: rectScore.maxX,
        endY: rectScore.maxY,
      };
    }

    return null;
  }

  /**
   * Force-create a shape from start/end points for the shape tool.
   */
  static createShape(
    type: ShapeType,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    constrain: boolean = false
  ): ShapeData {
    if (constrain) {
      // Make square/circle when constrained
      const dx = endX - startX;
      const dy = endY - startY;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      endX = startX + size * Math.sign(dx);
      endY = startY + size * Math.sign(dy);
    }

    switch (type) {
      case 'circle': {
        const cx = (startX + endX) / 2;
        const cy = (startY + endY) / 2;
        const rx = Math.abs(endX - startX) / 2;
        const ry = Math.abs(endY - startY) / 2;
        const radius = constrain ? Math.max(rx, ry) : (rx + ry) / 2;
        return { type: 'circle', startX, startY, endX, endY, cx, cy, radius };
      }
      case 'arrow':
        return { type: 'arrow', startX, startY, endX, endY };
      case 'rectangle':
        return { type: 'rectangle', startX, startY, endX, endY };
      case 'line':
      default:
        return { type: 'line', startX, startY, endX, endY };
    }
  }

  // ─── Scoring functions ────────────────────────────────────────

  private static lineScore(points: Point[]): number {
    const first = points[0];
    const last = points[points.length - 1];
    const totalDist = Math.sqrt(
      (last.x - first.x) ** 2 + (last.y - first.y) ** 2
    );

    if (totalDist < 10) return 0;

    let pathLen = 0;
    for (let i = 1; i < points.length; i++) {
      pathLen += Math.sqrt(
        (points[i].x - points[i - 1].x) ** 2 +
        (points[i].y - points[i - 1].y) ** 2
      );
    }

    return totalDist / pathLen;
  }

  private static snapToLine(points: Point[]): ShapeData {
    const first = points[0];
    const last = points[points.length - 1];

    // Snap to horizontal/vertical if close
    const dx = Math.abs(last.x - first.x);
    const dy = Math.abs(last.y - first.y);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    let endX = last.x;
    let endY = last.y;

    if (angle < 8) {
      endY = first.y; // snap horizontal
    } else if (angle > 82) {
      endX = first.x; // snap vertical
    } else if (Math.abs(angle - 45) < 8) {
      const dist = Math.max(dx, dy);
      endX = first.x + dist * Math.sign(last.x - first.x);
      endY = first.y + dist * Math.sign(last.y - first.y);
    }

    return {
      type: 'line',
      startX: first.x,
      startY: first.y,
      endX,
      endY,
    };
  }

  private static circleScore(points: Point[]): {
    score: number;
    cx: number;
    cy: number;
    radius: number;
  } {
    // Compute centroid
    let cx = 0, cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;

    // Compute average radius and variance
    let avgR = 0;
    const radii: number[] = [];
    for (const p of points) {
      const r = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
      radii.push(r);
      avgR += r;
    }
    avgR /= points.length;

    if (avgR < 10) return { score: 0, cx, cy, radius: avgR };

    let variance = 0;
    for (const r of radii) {
      variance += ((r - avgR) / avgR) ** 2;
    }
    variance /= points.length;

    // Check closure (first and last point should be close)
    const first = points[0];
    const last = points[points.length - 1];
    const closureDist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
    const closureScore = Math.max(0, 1 - closureDist / (avgR * 2));

    const score = Math.max(0, (1 - Math.sqrt(variance) * 3) * 0.7 + closureScore * 0.3);

    return { score, cx, cy, radius: avgR };
  }

  private static rectangleScore(points: Point[]): {
    score: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 15 || h < 15) return { score: 0, minX, minY, maxX, maxY };

    // Score: how many points are near the edges of the bounding box
    const edgeThreshold = Math.min(w, h) * 0.15;
    let nearEdge = 0;

    for (const p of points) {
      const distToLeft = Math.abs(p.x - minX);
      const distToRight = Math.abs(p.x - maxX);
      const distToTop = Math.abs(p.y - minY);
      const distToBottom = Math.abs(p.y - maxY);
      const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
      if (minDist < edgeThreshold) nearEdge++;
    }

    // Check closure
    const first = points[0];
    const last = points[points.length - 1];
    const closureDist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
    const diag = Math.sqrt(w * w + h * h);
    const closureScore = Math.max(0, 1 - closureDist / (diag * 0.3));

    const edgeScore = nearEdge / points.length;
    const score = edgeScore * 0.7 + closureScore * 0.3;

    return { score, minX, minY, maxX, maxY };
  }
}
