import { Point, Stroke, StrokeStyle } from '../types';
import getStroke from 'perfect-freehand';

/**
 * High-performance stroke renderer.
 *
 * Architecture:
 * - pen / pencil / fountain  → perfect-freehand (pressure-sensitive variable-width outline)
 * - highlighter              → Catmull-Rom spline, thick, multiply blend
 * - calligraphy              → angle-sensitive nib polygon
 * - marker                  → Catmull-Rom, thick, multiply blend
 * - spray                   → seeded scatter dots
 *
 * Performance notes:
 * - getSvgPathFromStroke uses quadratic midpoint curves (smooth, fast)
 * - renderStrokeLive re-renders the whole live stroke each RAF (perfect-freehand
 *   needs all points for correct taper/pressure). The overlay canvas is cleared
 *   each frame so this is safe.
 * - Linear interpolation fills gaps between sparse fast-drawn points so that
 *   fast dashes/pencil strokes are never lost.
 */
export class StrokeRenderer {

  // ─── perfect-freehand SVG path ────────────────────────────

  private static getSvgPathFromStroke(pts: number[][]): string {
    if (!pts.length) return '';
    const d: string[] = [];
    d.push(`M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`);
    if (pts.length === 1) { d.push('Z'); return d.join(' '); }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      d.push(`Q ${a[0].toFixed(2)} ${a[1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`);
    }
    d.push('Z');
    return d.join(' ');
  }

  // ─── perfect-freehand options per tool ────────────────────

  private static getFreehandOptions(style: StrokeStyle) {
    const base = {
      size: style.width * 2.2,
      smoothing: 0.5,
      thinning: 0.5,
      streamline: 0.4,          // reduced from 0.5 — less lag on fast strokes
      easing: (t: number) => t * t * (3 - 2 * t),
      start: { taper: 0, cap: true },
      end: { taper: 0, cap: true },
      simulatePressure: false,
    };
    switch (style.tool) {
      case 'pen':
        return { ...base, size: style.width * 2.2, thinning: 0.55, smoothing: 0.45, streamline: 0.38 };
      case 'pencil':
        // Lower streamline so fast dashes don't lag/drop
        return { ...base, size: style.width * 1.8, thinning: 0.55, smoothing: 0.5, streamline: 0.25 };
      case 'fountain':
        return {
          ...base,
          size: style.width * 2.8,
          thinning: 0.7,
          smoothing: 0.4,
          streamline: 0.3,
          start: { taper: 20, cap: true },
          end: { taper: 15, cap: true },
        };
      default:
        return base;
    }
  }

  // ─── Gap interpolation ────────────────────────────────────
  /**
   * When drawing fast, pointer events can be spaced far apart.
   * Interpolate linearly between consecutive points that are more than
   * `maxGap` pixels apart, so fast dashes / pencil strokes are never lost.
   */
  private static interpolatePoints(points: Point[], maxGap = 4): Point[] {
    if (points.length < 2) return points;
    const result: Point[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = result[result.length - 1];
      const curr = points[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxGap) {
        const steps = Math.ceil(dist / maxGap);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          result.push({
            x: prev.x + dx * t,
            y: prev.y + dy * t,
            pressure: prev.pressure + (curr.pressure - prev.pressure) * t,
            timestamp: prev.timestamp + (curr.timestamp - prev.timestamp) * t,
          });
        }
      }
      result.push(curr);
    }
    return result;
  }

  // ─── Public API ───────────────────────────────────────────

  static renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.shapeData) { StrokeRenderer.renderShape(ctx, stroke); return; }
    const { points, style } = stroke;
    if (points.length === 0) return;
    ctx.save();
    StrokeRenderer.applyStyle(ctx, style);
    if (points.length === 1) {
      StrokeRenderer.renderDot(ctx, points[0], style);
    } else {
      StrokeRenderer.dispatchRender(ctx, points, style);
    }
    ctx.restore();
  }

  static renderStrokeLive(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle,
    _startIndex = 0
  ): void {
    if (points.length === 0) return;
    ctx.save();
    StrokeRenderer.applyStyle(ctx, style);
    if (points.length === 1) {
      StrokeRenderer.renderDot(ctx, points[0], style);
    } else {
      StrokeRenderer.dispatchRender(ctx, points, style);
    }
    ctx.restore();
  }

  // ─── Dispatch to renderer ─────────────────────────────────

  private static dispatchRender(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle
  ): void {
    switch (style.tool) {
      case 'pen':
      case 'pencil':
      case 'fountain':
        StrokeRenderer.renderFreehand(ctx, points, style);
        break;
      case 'highlighter':
        StrokeRenderer.renderHighlighter(ctx, points, style);
        break;
      case 'calligraphy':
        StrokeRenderer.renderCalligraphy(ctx, points, style);
        break;
      case 'marker':
        StrokeRenderer.renderMarker(ctx, points, style);
        break;
      case 'spray':
        StrokeRenderer.renderSpray(ctx, points, style);
        break;
      default:
        StrokeRenderer.renderFreehand(ctx, points, style);
    }
  }

  // ─── Style setup ──────────────────────────────────────────

  private static applyStyle(ctx: CanvasRenderingContext2D, style: StrokeStyle): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = style.opacity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;

    switch (style.tool) {
      case 'eraser':
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = style.width;
        break;
      case 'highlighter':
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineWidth = style.width * 3;
        ctx.globalAlpha = 0.35;
        ctx.lineCap = 'square';
        break;
      case 'pencil':
        ctx.globalAlpha = style.opacity * 0.75;
        break;
      case 'marker':
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineCap = 'square';
        ctx.lineJoin = 'miter';
        ctx.lineWidth = style.width * 4;
        ctx.globalAlpha = 0.55;
        break;
      case 'spray':
        // no extra setup needed
        break;
      default:
        ctx.lineWidth = style.width;
    }
  }

  // ─── Dot (single point) ───────────────────────────────────

  private static renderDot(ctx: CanvasRenderingContext2D, point: Point, style: StrokeStyle): void {
    const r = StrokeRenderer.getWidth(style, point.pressure) / 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(r, 0.5), 0, Math.PI * 2);
    ctx.fillStyle = style.tool === 'eraser' ? 'rgba(0,0,0,1)' : style.color;
    ctx.fill();
  }

  // ─── perfect-freehand (pen / pencil / fountain) ───────────

  private static renderFreehand(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle
  ): void {
    // Interpolate gaps so fast strokes don't lose segments
    const filled = StrokeRenderer.interpolatePoints(points, 3);
    const input: [number, number, number][] = filled.map(p => [p.x, p.y, p.pressure]);
    const opts = StrokeRenderer.getFreehandOptions(style);
    const outline = getStroke(input, opts);
    if (!outline.length) return;
    const path = new Path2D(StrokeRenderer.getSvgPathFromStroke(outline));
    ctx.fill(path);
  }

  // ─── Highlighter: Catmull-Rom spline, thick ───────────────

  private static renderHighlighter(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle
  ): void {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    // Catmull-Rom via Bezier control points
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[Math.min(i + 1, points.length - 1)];
      const p3 = points[Math.min(i + 2, points.length - 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  }

  // ─── Calligraphy: angle-sensitive nib ─────────────────────

  private static renderCalligraphy(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle
  ): void {
    const nibAngle = Math.PI / 4;
    const maxW = style.width * 2.5;
    const minW = style.width * 0.3;

    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[Math.max(i - 1, 0)];
      const next = points[Math.min(i + 1, points.length - 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const sa = Math.atan2(dy, dx);
      const w = (minW + (maxW - minW) * Math.abs(Math.sin(sa - nibAngle))) / 2;
      const nx = Math.cos(nibAngle) * w;
      const ny = Math.sin(nibAngle) * w;
      if (i === 0) ctx.moveTo(p.x + nx, p.y + ny);
      else ctx.lineTo(p.x + nx, p.y + ny);
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      const prev = points[Math.max(i - 1, 0)];
      const next = points[Math.min(i + 1, points.length - 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const sa = Math.atan2(dy, dx);
      const w = (minW + (maxW - minW) * Math.abs(Math.sin(sa - nibAngle))) / 2;
      const nx = Math.cos(nibAngle) * w;
      const ny = Math.sin(nibAngle) * w;
      ctx.lineTo(p.x - nx, p.y - ny);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ─── Marker: Catmull-Rom, thick, multiply ─────────────────

  private static renderMarker(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    _style: StrokeStyle
  ): void {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[Math.min(i + 1, points.length - 1)];
      const p3 = points[Math.min(i + 2, points.length - 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  }

  // ─── Spray: seeded scatter dots ───────────────────────────

  private static renderSpray(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle
  ): void {
    const radius = style.width * 3;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const density = Math.floor(8 + p.pressure * 25);
      let seed = (p.x * 73856093 + p.y * 19349663 + i * 83492791) | 0;
      for (let j = 0; j < density; j++) {
        seed = (seed * 1664525 + 1013904223) | 0;
        const angle = ((seed >>> 0) / 4294967296) * Math.PI * 2;
        seed = (seed * 1664525 + 1013904223) | 0;
        const dist = ((seed >>> 0) / 4294967296) * radius * p.pressure;
        const sx = p.x + Math.cos(angle) * dist;
        const sy = p.y + Math.sin(angle) * dist;
        const dotR = 0.5 + ((seed >>> 16) & 0xFF) / 255 * 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ─── Shape rendering ──────────────────────────────────────

  private static renderShape(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (!stroke.shapeData) return;
    const { shapeData: s, style } = stroke;
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.globalAlpha = style.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (s.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(s.startX, s.startY);
      ctx.lineTo(s.endX, s.endY);
      ctx.stroke();
    } else if (s.type === 'circle') {
      const cx = s.cx ?? (s.startX + s.endX) / 2;
      const cy = s.cy ?? (s.startY + s.endY) / 2;
      const rx = Math.abs(s.endX - s.startX) / 2;
      const ry = Math.abs(s.endY - s.startY) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'rectangle') {
      ctx.strokeRect(
        Math.min(s.startX, s.endX), Math.min(s.startY, s.endY),
        Math.abs(s.endX - s.startX), Math.abs(s.endY - s.startY)
      );
    } else if (s.type === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(s.startX, s.startY);
      ctx.lineTo(s.endX, s.endY);
      ctx.stroke();
      const angle = Math.atan2(s.endY - s.startY, s.endX - s.startX);
      const hl = 15;
      ctx.beginPath();
      ctx.moveTo(s.endX, s.endY);
      ctx.lineTo(s.endX - hl * Math.cos(angle - Math.PI / 6), s.endY - hl * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(s.endX, s.endY);
      ctx.lineTo(s.endX - hl * Math.cos(angle + Math.PI / 6), s.endY - hl * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── Width helper ─────────────────────────────────────────

  static getWidth(style: StrokeStyle, pressure: number): number {
    const minW = style.width * 0.25;
    const maxW = style.width * 1.5;
    const t = Math.max(0.05, Math.min(1, pressure));
    const s = t * t * (3 - 2 * t);
    return minW + (maxW - minW) * (s * 0.7 + t * 0.3);
  }
}
