import { Point, Stroke, StrokeStyle } from '../types';

/**
 * High-performance stroke renderer using Catmull-Rom spline interpolation
 * for buttery smooth curves from stylus input.
 */
export class StrokeRenderer {
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
      // Dispatch to specialized renderers
      switch (style.tool) {
        case 'calligraphy':
          StrokeRenderer.renderCalligraphy(ctx, points, style);
          break;
        case 'fountain':
          StrokeRenderer.renderFountain(ctx, points, style);
          break;
        case 'marker':
          StrokeRenderer.renderMarker(ctx, points, style);
          break;
        case 'spray':
          StrokeRenderer.renderSpray(ctx, points, style);
          break;
        default:
          StrokeRenderer.renderCurve(ctx, points, style);
          break;
      }
    }

    ctx.restore();
  }

  /**
   * Render an in-progress stroke (optimized for real-time drawing).
   * Only renders the last few segments for performance.
   */
  static renderStrokeLive(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle,
    startIndex: number = 0
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

    const start = Math.max(0, startIndex - 2);
    const subset = points.slice(start);

    switch (style.tool) {
      case 'calligraphy':
        StrokeRenderer.renderCalligraphy(ctx, subset, style);
        break;
      case 'fountain':
        StrokeRenderer.renderFountain(ctx, subset, style);
        break;
      case 'marker':
        StrokeRenderer.renderMarker(ctx, subset, style);
        break;
      case 'spray':
        StrokeRenderer.renderSpray(ctx, subset, style);
        break;
      default:
        if (subset.length >= 3) {
          StrokeRenderer.renderCurve(ctx, subset, style);
        } else {
          StrokeRenderer.renderLine(ctx, subset[0], subset[subset.length - 1], style);
        }
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
      ctx.lineWidth = style.width;
    } else if (style.tool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width * 3;
      ctx.globalAlpha = 0.3;
    } else if (style.tool === 'pencil') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = style.color;
      ctx.globalAlpha = style.opacity * 0.7;
    } else if (style.tool === 'calligraphy') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = style.color;
      ctx.strokeStyle = style.color;
    } else if (style.tool === 'fountain') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = style.color;
      ctx.lineCap = 'round';
    } else if (style.tool === 'marker') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = style.color;
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
    ctx.lineWidth = StrokeRenderer.getWidth(style, (p0.pressure + p1.pressure) / 2);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  /**
   * Render smooth curve using Catmull-Rom → Bezier conversion
   * with variable width based on pressure.
   */
  private static renderCurve(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    const usePressure = style.tool === 'pen' || style.tool === 'pencil';

    if (!usePressure) {
      ctx.lineWidth = style.width;
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
      return;
    }

    // Variable width: segment-by-segment with pressure
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[Math.min(i + 1, points.length - 1)];
      const p3 = points[Math.min(i + 2, points.length - 1)];

      const pressure = (p1.pressure + p2.pressure) / 2;
      ctx.lineWidth = StrokeRenderer.getWidth(style, pressure);

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      ctx.stroke();
    }
  }

  // ─── Calligraphy: angled nib with pressure-sensitive width ───

  private static renderCalligraphy(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    const nibAngle = Math.PI / 4; // 45-degree nib angle
    const maxWidth = style.width * 3;

    ctx.beginPath();

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const pressure = (p1.pressure + p2.pressure) / 2;
      const w = maxWidth * Math.max(0.1, pressure);

      // Direction of stroke
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const strokeAngle = Math.atan2(dy, dx);

      // Width varies based on angle relative to nib
      const angleDiff = Math.abs(strokeAngle - nibAngle);
      const widthFactor = 0.15 + 0.85 * Math.abs(Math.sin(angleDiff));
      const halfW = (w * widthFactor) / 2;

      // Perpendicular offset
      const px = Math.cos(nibAngle + Math.PI / 2) * halfW;
      const py = Math.sin(nibAngle + Math.PI / 2) * halfW;

      // Draw a quad for each segment
      ctx.moveTo(p1.x - px, p1.y - py);
      ctx.lineTo(p1.x + px, p1.y + py);
      ctx.lineTo(p2.x + px, p2.y + py);
      ctx.lineTo(p2.x - px, p2.y - py);
      ctx.closePath();
    }

    ctx.fill();
  }

  // ─── Fountain Pen: smooth variable width with ink pooling feel ───

  private static renderFountain(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    const minW = style.width * 0.2;
    const maxW = style.width * 2.5;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[Math.min(i + 1, points.length - 1)];
      const p3 = points[Math.min(i + 2, points.length - 1)];

      // Smooth pressure with neighbors
      const pressure = (p0.pressure * 0.1 + p1.pressure * 0.4 + p2.pressure * 0.4 + p3.pressure * 0.1);
      const t = Math.max(0.05, pressure);
      const eased = t * t * (3 - 2 * t); // smoothstep
      ctx.lineWidth = minW + (maxW - minW) * eased;

      // Speed-based thinning: faster = thinner
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = Math.max(1, p2.timestamp - p1.timestamp);
      const speed = dist / dt;
      const speedFactor = Math.max(0.4, 1 - speed * 0.08);
      ctx.lineWidth *= speedFactor;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      ctx.stroke();
    }
  }

  // ─── Marker: thick, flat, semi-transparent ───

  private static renderMarker(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    // Marker uses a single smooth path at fixed width (set in applyStyle)
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

  // ─── Spray Can: scattered dots with density based on pressure ───

  private static renderSpray(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    const radius = style.width * 3;

    // Use a seeded approach based on point data for consistent rendering
    for (const point of points) {
      const density = Math.floor(12 + 28 * point.pressure);
      // Deterministic pseudo-random from point coordinates
      let seed = Math.floor(point.x * 1000 + point.y * 7919 + point.timestamp);
      for (let i = 0; i < density; i++) {
        seed = (seed * 16807 + 0) % 2147483647;
        const angle = (seed / 2147483647) * Math.PI * 2;
        seed = (seed * 16807 + 0) % 2147483647;
        const r = (seed / 2147483647) * radius * Math.sqrt(seed / 2147483647);
        const sx = point.x + Math.cos(angle) * r;
        const sy = point.y + Math.sin(angle) * r;
        const dotSize = 0.5 + (seed / 2147483647) * 1.5;

        ctx.globalAlpha = style.opacity * (0.3 + 0.7 * (1 - r / radius));
        ctx.beginPath();
        ctx.arc(sx, sy, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private static renderShape(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const { shapeData, style } = stroke;
    if (!shapeData) return;

    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.globalAlpha = style.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();

    switch (shapeData.type) {
      case 'line':
        ctx.moveTo(shapeData.startX, shapeData.startY);
        ctx.lineTo(shapeData.endX, shapeData.endY);
        break;
      case 'rectangle':
        ctx.rect(
          Math.min(shapeData.startX, shapeData.endX),
          Math.min(shapeData.startY, shapeData.endY),
          Math.abs(shapeData.endX - shapeData.startX),
          Math.abs(shapeData.endY - shapeData.startY)
        );
        break;
      case 'circle':
        if (shapeData.cx !== undefined && shapeData.cy !== undefined && shapeData.radius !== undefined) {
          ctx.arc(shapeData.cx, shapeData.cy, shapeData.radius, 0, Math.PI * 2);
        }
        break;
      case 'arrow': {
        const dx = shapeData.endX - shapeData.startX;
        const dy = shapeData.endY - shapeData.startY;
        const angle = Math.atan2(dy, dx);
        const headLen = Math.min(20, Math.sqrt(dx * dx + dy * dy) * 0.3);

        ctx.moveTo(shapeData.startX, shapeData.startY);
        ctx.lineTo(shapeData.endX, shapeData.endY);
        ctx.moveTo(shapeData.endX, shapeData.endY);
        ctx.lineTo(
          shapeData.endX - headLen * Math.cos(angle - Math.PI / 6),
          shapeData.endY - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(shapeData.endX, shapeData.endY);
        ctx.lineTo(
          shapeData.endX - headLen * Math.cos(angle + Math.PI / 6),
          shapeData.endY - headLen * Math.sin(angle + Math.PI / 6)
        );
        break;
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  /**
   * Calculate width from pressure. Maps pressure [0,1] to a pleasant width curve.
   */
  static getWidth(style: StrokeStyle, pressure: number): number {
    const minW = style.width * 0.3;
    const maxW = style.width * 1.4;
    // Ease-in-out curve for natural feel
    const t = Math.max(0.05, pressure);
    const eased = t * t * (3 - 2 * t);
    return minW + (maxW - minW) * eased;
  }
}
