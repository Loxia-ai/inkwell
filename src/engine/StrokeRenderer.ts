import { Point, Stroke, StrokeStyle } from '../types';
import getStroke from 'perfect-freehand';

/**
 * High-performance stroke renderer with:
 * - perfect-freehand for pen/pencil/fountain (natural variable-width strokes)
 * - Catmull-Rom splines for highlighter (non-pressure)
 * - Custom renderers for calligraphy, marker, spray
 */
export class StrokeRenderer {

  // ─── perfect-freehand SVG path helper ───────────────────────

  /**
   * Convert perfect-freehand outline points to a single SVG path string
   * that can be used with Path2D for efficient canvas rendering.
   */
  private static getSvgPathFromStroke(strokePoints: number[][]): string {
    if (!strokePoints.length) return '';

    const d: string[] = [];
    const [first, ...rest] = strokePoints;

    d.push(`M ${first[0].toFixed(2)} ${first[1].toFixed(2)}`);

    if (rest.length === 0) {
      d.push('Z');
      return d.join(' ');
    }

    // Use quadratic curves between midpoints for smooth outline
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      const b = rest[(i + 1) % rest.length];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      d.push(`Q ${a[0].toFixed(2)} ${a[1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`);
    }

    d.push('Z');
    return d.join(' ');
  }

  /**
   * Get perfect-freehand options for a given tool and style.
   */
  private static getFreehandOptions(style: StrokeStyle) {
    const base = {
      size: style.width * 2.2,
      smoothing: 0.5,
      thinning: 0.5,
      streamline: 0.5,
      easing: (t: number) => t * t * (3 - 2 * t), // smoothstep
      start: { taper: 0, cap: true },
      end: { taper: 0, cap: true },
      simulatePressure: false, // we have real pressure data
    };

    switch (style.tool) {
      case 'pen':
        return {
          ...base,
          size: style.width * 2.2,
          thinning: 0.55,
          smoothing: 0.45,
          streamline: 0.45,
        };
      case 'pencil':
        return {
          ...base,
          size: style.width * 1.8,
          thinning: 0.6,
          smoothing: 0.6,
          streamline: 0.55,
        };
      case 'fountain':
        return {
          ...base,
          size: style.width * 2.8,
          thinning: 0.7,
          smoothing: 0.4,
          streamline: 0.35,
          start: { taper: 20, cap: true },
          end: { taper: 15, cap: true },
        };
      default:
        return base;
    }
  }

  /**
   * Render a complete stroke to the canvas context.
   */
  static renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.shapeData) {
      StrokeRenderer.renderShape(ctx, stroke);
      return;
    }

    const { points, style } = stroke;
    if (points.length === 0) return;

    ctx.save();
    StrokeRenderer.applyStyle(ctx, style);

    if (points.length === 1) {
      StrokeRenderer.renderDot(ctx, points[0], style);
    } else if (points.length === 2) {
      StrokeRenderer.renderLine(ctx, points[0], points[1], style);
    } else {
      switch (style.tool) {
        case 'pen':
        case 'pencil':
        case 'fountain':
          StrokeRenderer.renderFreehand(ctx, points, style);
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
          break;
      }
    }

    ctx.restore();
  }

  /**
   * Render an in-progress stroke (optimized for real-time drawing).
   */
  static renderStrokeLive(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle,
    _startIndex: number = 0
  ): void {
    if (points.length < 2) {
      if (points.length === 1) {
        ctx.save();
        StrokeRenderer.applyStyle(ctx, style);
        StrokeRenderer.renderDot(ctx, points[0], style);
        ctx.restore();
      }
      return;
    }

    ctx.save();
    StrokeRenderer.applyStyle(ctx, style);

    switch (style.tool) {
      case 'pen':
      case 'pencil':
      case 'fountain':
        StrokeRenderer.renderFreehand(ctx, points, style);
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
        break;
    }

    ctx.restore();
  }

  private static applyStyle(ctx: CanvasRenderingContext2D, style: StrokeStyle): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = style.opacity;

    if (style.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = style.width;
    } else if (style.tool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.lineWidth = style.width * 3;
      ctx.globalAlpha = 0.3;
    } else if (style.tool === 'pencil') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.globalAlpha = style.opacity * 0.7;
    } else if (style.tool === 'calligraphy') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = style.color;
      ctx.strokeStyle = style.color;
    } else if (style.tool === 'fountain') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.lineCap = 'round';
    } else if (style.tool === 'marker') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      ctx.lineWidth = style.width * 4;
      ctx.globalAlpha = 0.55;
    } else if (style.tool === 'spray') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = style.color;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.lineWidth = style.width;
    }
  }

  private static renderDot(ctx: CanvasRenderingContext2D, point: Point, style: StrokeStyle): void {
    const r = StrokeRenderer.getWidth(style, point.pressure) / 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(r, 0.5), 0, Math.PI * 2);
    ctx.fillStyle = style.tool === 'eraser' ? 'rgba(0,0,0,1)' : style.color;
    ctx.fill();
  }

  private static renderLine(ctx: CanvasRenderingContext2D, p0: Point, p1: Point, style: StrokeStyle): void {
    const usePressure = style.tool === 'pen' || style.tool === 'pencil' || style.tool === 'fountain' || style.tool === 'eraser';
    if (usePressure) {
      // Use perfect-freehand even for 2-point lines
      const inputPoints: [number, number, number][] = [
        [p0.x, p0.y, p0.pressure],
        [p1.x, p1.y, p1.pressure],
      ];
      const options = StrokeRenderer.getFreehandOptions(style);
      const outlinePoints = getStroke(inputPoints, options);
      const pathStr = StrokeRenderer.getSvgPathFromStroke(outlinePoints);
      if (pathStr) {
        const path = new Path2D(pathStr);
        ctx.fill(path);
      }
    } else {
      ctx.lineWidth = StrokeRenderer.getWidth(style, (p0.pressure + p1.pressure) / 2);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  // ─── perfect-freehand rendering for pen/pencil/fountain ───

  private static renderFreehand(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    // Convert to perfect-freehand input format: [x, y, pressure]
    const inputPoints: [number, number, number][] = points.map(p => [p.x, p.y, p.pressure]);
    const options = StrokeRenderer.getFreehandOptions(style);
    const outlinePoints = getStroke(inputPoints, options);
    
    if (outlinePoints.length === 0) return;

    const pathStr = StrokeRenderer.getSvgPathFromStroke(outlinePoints);
    if (!pathStr) return;

    const path = new Path2D(pathStr);
    ctx.fill(path);
  }

  // ─── Calligraphy: angle-sensitive nib ───

  private static renderCalligraphy(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    const nibAngle = Math.PI / 4; // 45° nib angle
    const maxWidth = style.width * 2.5;
    const minWidth = style.width * 0.3;

    ctx.beginPath();

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[Math.max(i - 1, 0)];
      const next = points[Math.min(i + 1, points.length - 1)];

      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const strokeAngle = Math.atan2(dy, dx);

      const angleDiff = Math.abs(Math.sin(strokeAngle - nibAngle));
      const w = minWidth + (maxWidth - minWidth) * angleDiff;

      const nx = Math.cos(nibAngle) * w / 2;
      const ny = Math.sin(nibAngle) * w / 2;

      if (i === 0) {
        ctx.moveTo(p.x + nx, p.y + ny);
      } else {
        ctx.lineTo(p.x + nx, p.y + ny);
      }
    }

    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      const prev = points[Math.max(i - 1, 0)];
      const next = points[Math.min(i + 1, points.length - 1)];

      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const strokeAngle = Math.atan2(dy, dx);

      const angleDiff = Math.abs(Math.sin(strokeAngle - nibAngle));
      const w = minWidth + (maxWidth - minWidth) * angleDiff;

      const nx = Math.cos(nibAngle) * w / 2;
      const ny = Math.sin(nibAngle) * w / 2;

      ctx.lineTo(p.x - nx, p.y - ny);
    }

    ctx.closePath();
    ctx.fill();
  }

  // ─── Marker: thick flat semi-transparent ───

  private static renderMarker(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    ctx.lineWidth = style.width * 4;
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

  // ─── Spray Can: scattered dots ───

  private static renderSpray(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
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

  // ─── Shape rendering ───────────────────────────────────────

  private static renderShape(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (!stroke.shapeData) return;
    const shape = stroke.shapeData;
    const style = stroke.style;

    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.globalAlpha = style.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(shape.startX, shape.startY);
      ctx.lineTo(shape.endX, shape.endY);
      ctx.stroke();
    } else if (shape.type === 'circle') {
      const cx = shape.cx ?? (shape.startX + shape.endX) / 2;
      const cy = shape.cy ?? (shape.startY + shape.endY) / 2;
      const rx = Math.abs(shape.endX - shape.startX) / 2;
      const ry = Math.abs(shape.endY - shape.startY) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape.type === 'rectangle') {
      const x = Math.min(shape.startX, shape.endX);
      const y = Math.min(shape.startY, shape.endY);
      const w = Math.abs(shape.endX - shape.startX);
      const h = Math.abs(shape.endY - shape.startY);
      ctx.strokeRect(x, y, w, h);
    } else if (shape.type === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(shape.startX, shape.startY);
      ctx.lineTo(shape.endX, shape.endY);
      ctx.stroke();

      const angle = Math.atan2(shape.endY - shape.startY, shape.endX - shape.startX);
      const headLen = 15;
      ctx.beginPath();
      ctx.moveTo(shape.endX, shape.endY);
      ctx.lineTo(
        shape.endX - headLen * Math.cos(angle - Math.PI / 6),
        shape.endY - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(shape.endX, shape.endY);
      ctx.lineTo(
        shape.endX - headLen * Math.cos(angle + Math.PI / 6),
        shape.endY - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Calculate width from pressure with natural pen feel.
   */
  static getWidth(style: StrokeStyle, pressure: number): number {
    const minW = style.width * 0.25;
    const maxW = style.width * 1.5;
    const t = Math.max(0.05, Math.min(1, pressure));
    const s = t * t * (3 - 2 * t);
    const eased = s * 0.7 + t * 0.3;
    return minW + (maxW - minW) * eased;
  }
}
