import { Point, Stroke, StrokeStyle } from '../types';

/**
 * High-performance stroke renderer with:
 * - Catmull-Rom → Cubic Bezier spline interpolation
 * - Pressure smoothing via exponential moving average
 * - Variable-width stroke rendering using filled polygons (no segment gaps)
 * - Sub-pixel precision for crisp output
 */
export class StrokeRenderer {
  // ─── Pressure smoothing cache ───────────────────────────────
  private static pressureCache = new WeakMap<Point[], Float64Array>();

  /**
   * Smooth pressure values using adaptive bilateral filter.
   * Uses distance-weighted Gaussian kernel that preserves intentional
   * pressure changes while eliminating sensor jitter.
   */
  private static getSmoothedPressures(points: Point[]): Float64Array {
    const cached = StrokeRenderer.pressureCache.get(points);
    if (cached && cached.length === points.length) return cached;

    const n = points.length;
    const smoothed = new Float64Array(n);
    if (n === 0) return smoothed;
    if (n === 1) { smoothed[0] = Math.max(0.1, points[0].pressure); return smoothed; }

    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      raw[i] = Math.max(0.05, points[i].pressure);
    }

    // Adaptive alpha based on distance — fast strokes get more smoothing
    // Three-pass smoothing: forward EMA, backward EMA, Gaussian kernel

    // Pass 1: Forward EMA with adaptive alpha
    const pass1 = new Float64Array(n);
    pass1[0] = raw[0];
    for (let i = 1; i < n; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Closer points → more smoothing (lower alpha = more lag)
      // Farther points → less smoothing (preserve intentional change)
      const alpha = Math.min(0.6, Math.max(0.15, dist / 20));
      pass1[i] = alpha * raw[i] + (1 - alpha) * pass1[i - 1];
    }

    // Pass 2: Backward EMA with same adaptive logic
    const pass2 = new Float64Array(n);
    pass2[n - 1] = pass1[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.min(0.6, Math.max(0.15, dist / 20));
      pass2[i] = alpha * pass1[i] + (1 - alpha) * pass2[i + 1];
    }

    // Pass 3: Local Gaussian kernel (window=7) for final polish
    const KERNEL_RADIUS = 3;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let weightSum = 0;
      for (let j = -KERNEL_RADIUS; j <= KERNEL_RADIUS; j++) {
        const idx = Math.max(0, Math.min(n - 1, i + j));
        const weight = Math.exp(-(j * j) / (2 * 2)); // sigma=2
        sum += pass2[idx] * weight;
        weightSum += weight;
      }
      smoothed[i] = Math.max(0.05, sum / weightSum);
    }

    StrokeRenderer.pressureCache.set(points, smoothed);
    return smoothed;
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
   * Uses full point set for smooth result, but limits redraw area.
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
    const usePressure = style.tool === 'pen' || style.tool === 'pencil' || style.tool === 'eraser';
    if (usePressure) {
      // Render as filled polygon for smooth variable width
      const w0 = StrokeRenderer.getWidth(style, p0.pressure) / 2;
      const w1 = StrokeRenderer.getWidth(style, p1.pressure) / 2;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      ctx.beginPath();
      ctx.moveTo(p0.x + nx * w0, p0.y + ny * w0);
      ctx.lineTo(p1.x + nx * w1, p1.y + ny * w1);
      ctx.lineTo(p1.x - nx * w1, p1.y - ny * w1);
      ctx.lineTo(p0.x - nx * w0, p0.y - ny * w0);
      ctx.closePath();
      ctx.fill();

      // Round caps
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, w0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, w1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = StrokeRenderer.getWidth(style, (p0.pressure + p1.pressure) / 2);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  /**
   * Render smooth curve using filled polygon with variable width.
   * This eliminates gaps between segments that occur with stroke-based rendering.
   * Uses Catmull-Rom spline interpolation for the centerline, then offsets
   * perpendicular by the pressure-derived width to create a smooth outline.
   */
  private static renderCurve(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    const usePressure = style.tool === 'pen' || style.tool === 'pencil' || style.tool === 'eraser';

    if (!usePressure) {
      // Non-pressure: single smooth bezier path
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

    // ─── Variable-width stroke as filled polygon ──────────────
    // Interpolate the centerline at higher resolution, then build
    // left/right outlines offset by the smoothed pressure width.

    const smoothedPressures = StrokeRenderer.getSmoothedPressures(points);
    const n = points.length;

    // Generate interpolated centerline points with adaptive subdivision
    const centerline: { x: number; y: number; w: number }[] = [];

    for (let i = 0; i < n - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[Math.min(i + 1, n - 1)];
      const p3 = points[Math.min(i + 2, n - 1)];

      const w1 = StrokeRenderer.getWidth(style, smoothedPressures[i]);
      const w2 = StrokeRenderer.getWidth(style, smoothedPressures[Math.min(i + 1, n - 1)]);

      // Adaptive subdivision: more subdivisions for longer segments and
      // where width changes significantly (thick↔thin transitions)
      const segDx = p2.x - p1.x;
      const segDy = p2.y - p1.y;
      const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
      const widthDelta = Math.abs(w2 - w1);
      // Base 4 subs, up to 12 for long segments or big width changes
      const SUBDIVISIONS = Math.max(4, Math.min(12,
        Math.ceil(segLen / 4) + Math.ceil(widthDelta / 0.5)
      ));

      for (let s = 0; s < SUBDIVISIONS; s++) {
        const t = s / SUBDIVISIONS;
        const tt = t * t;
        const ttt = tt * t;

        // Catmull-Rom interpolation
        const x = 0.5 * (
          (2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt
        );
        const y = 0.5 * (
          (2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt
        );
        // Smooth cubic interpolation for width (Hermite)
        const t2 = t * t;
        const t3 = t2 * t;
        const h = 3 * t2 - 2 * t3; // smoothstep
        const w = w1 + (w2 - w1) * h;

        centerline.push({ x, y, w: w / 2 });
      }
    }
    // Add last point
    const lastP = points[n - 1];
    const lastW = StrokeRenderer.getWidth(style, smoothedPressures[n - 1]);
    centerline.push({ x: lastP.x, y: lastP.y, w: lastW / 2 });

    // Post-process: smooth the widths along the centerline for silk-like transitions
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < centerline.length - 1; i++) {
        centerline[i].w = centerline[i].w * 0.5 +
          (centerline[i - 1].w + centerline[i + 1].w) * 0.25;
      }
    }

    if (centerline.length < 2) return;

    // Build left and right outline arrays
    const leftOutline: { x: number; y: number }[] = [];
    const rightOutline: { x: number; y: number }[] = [];

    for (let i = 0; i < centerline.length; i++) {
      const curr = centerline[i];
      const prev = centerline[Math.max(i - 1, 0)];
      const next = centerline[Math.min(i + 1, centerline.length - 1)];

      // Tangent direction
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tLen;
      ty /= tLen;

      // Normal (perpendicular)
      const nx = -ty;
      const ny = tx;

      leftOutline.push({ x: curr.x + nx * curr.w, y: curr.y + ny * curr.w });
      rightOutline.push({ x: curr.x - nx * curr.w, y: curr.y - ny * curr.w });
    }

    // Draw filled polygon: left outline forward, right outline backward
    ctx.beginPath();

    // Start cap (round)
    const startC = centerline[0];
    ctx.moveTo(leftOutline[0].x, leftOutline[0].y);

    // Left outline (forward) - smooth with quadratic curves
    for (let i = 1; i < leftOutline.length; i++) {
      const prev = leftOutline[i - 1];
      const curr = leftOutline[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.lineTo(leftOutline[leftOutline.length - 1].x, leftOutline[leftOutline.length - 1].y);

    // End cap (round arc)
    const endC = centerline[centerline.length - 1];
    ctx.arc(endC.x, endC.y, endC.w, 
      Math.atan2(leftOutline[leftOutline.length - 1].y - endC.y, leftOutline[leftOutline.length - 1].x - endC.x),
      Math.atan2(rightOutline[rightOutline.length - 1].y - endC.y, rightOutline[rightOutline.length - 1].x - endC.x),
      false
    );

    // Right outline (backward) - smooth with quadratic curves
    for (let i = rightOutline.length - 2; i >= 0; i--) {
      const prev = rightOutline[i + 1];
      const curr = rightOutline[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.lineTo(rightOutline[0].x, rightOutline[0].y);

    // Start cap (round arc)
    ctx.arc(startC.x, startC.y, startC.w,
      Math.atan2(rightOutline[0].y - startC.y, rightOutline[0].x - startC.x),
      Math.atan2(leftOutline[0].y - startC.y, leftOutline[0].x - startC.x),
      false
    );

    ctx.closePath();
    ctx.fill();
  }

  // ─── Calligraphy: angled nib with pressure-sensitive width ───

  private static renderCalligraphy(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    const nibAngle = Math.PI / 4; // 45-degree nib angle
    const smoothedPressures = StrokeRenderer.getSmoothedPressures(points);

    ctx.beginPath();
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // Direction of stroke affects nib width
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const angle = Math.atan2(dy, dx);
      const angleDiff = Math.abs(Math.sin(angle - nibAngle));

      const pressure = smoothedPressures[i];
      const baseWidth = style.width * 2;
      const w = baseWidth * (0.15 + 0.85 * angleDiff) * (0.5 + 0.5 * pressure);

      const nx = Math.cos(nibAngle) * w / 2;
      const ny = Math.sin(nibAngle) * w / 2;

      ctx.moveTo(p1.x - nx, p1.y - ny);
      ctx.lineTo(p1.x + nx, p1.y + ny);
      ctx.lineTo(p2.x + nx, p2.y + ny);
      ctx.lineTo(p2.x - nx, p2.y - ny);
      ctx.closePath();
    }
    ctx.fill();
  }

  // ─── Fountain Pen: speed-sensitive variable width ───

  private static renderFountain(ctx: CanvasRenderingContext2D, points: Point[], style: StrokeStyle): void {
    if (points.length < 2) return;

    const smoothedPressures = StrokeRenderer.getSmoothedPressures(points);
    const baseWidth = style.width * 1.8;

    // Build centerline with width based on speed + pressure
    const centerline: { x: number; y: number; w: number }[] = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let speed = 0;
      if (i > 0) {
        const prev = points[i - 1];
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        const dt = Math.max(1, p.timestamp - prev.timestamp);
        speed = Math.sqrt(dx * dx + dy * dy) / dt;
      }

      // Higher speed = thinner line (like real fountain pen)
      const speedFactor = 1 / (1 + speed * 2.5);
      const pressureFactor = 0.4 + 0.6 * smoothedPressures[i];
      const w = baseWidth * speedFactor * pressureFactor;

      centerline.push({ x: p.x, y: p.y, w: Math.max(0.5, w) / 2 });
    }

    // Smooth the widths for natural transitions
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < centerline.length - 1; i++) {
        centerline[i].w = centerline[i].w * 0.5 + 
          (centerline[i - 1].w + centerline[i + 1].w) * 0.25;
      }
    }

    // Build outlines
    const leftOutline: { x: number; y: number }[] = [];
    const rightOutline: { x: number; y: number }[] = [];

    for (let i = 0; i < centerline.length; i++) {
      const curr = centerline[i];
      const prev = centerline[Math.max(i - 1, 0)];
      const next = centerline[Math.min(i + 1, centerline.length - 1)];

      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tLen;
      ty /= tLen;

      const nx = -ty;
      const ny = tx;

      leftOutline.push({ x: curr.x + nx * curr.w, y: curr.y + ny * curr.w });
      rightOutline.push({ x: curr.x - nx * curr.w, y: curr.y - ny * curr.w });
    }

    // Draw as filled polygon
    ctx.beginPath();
    ctx.moveTo(leftOutline[0].x, leftOutline[0].y);

    for (let i = 1; i < leftOutline.length; i++) {
      const prev = leftOutline[i - 1];
      const curr = leftOutline[i];
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    }
    ctx.lineTo(leftOutline[leftOutline.length - 1].x, leftOutline[leftOutline.length - 1].y);

    // End cap
    const endC = centerline[centerline.length - 1];
    ctx.arc(endC.x, endC.y, endC.w,
      Math.atan2(leftOutline[leftOutline.length - 1].y - endC.y, leftOutline[leftOutline.length - 1].x - endC.x),
      Math.atan2(rightOutline[rightOutline.length - 1].y - endC.y, rightOutline[rightOutline.length - 1].x - endC.x),
      false
    );

    for (let i = rightOutline.length - 2; i >= 0; i--) {
      const prev = rightOutline[i + 1];
      const curr = rightOutline[i];
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    }
    ctx.lineTo(rightOutline[0].x, rightOutline[0].y);

    // Start cap
    const startC = centerline[0];
    ctx.arc(startC.x, startC.y, startC.w,
      Math.atan2(rightOutline[0].y - startC.y, rightOutline[0].x - startC.x),
      Math.atan2(leftOutline[0].y - startC.y, leftOutline[0].x - startC.x),
      false
    );

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

      // Deterministic pseudo-random based on point index + position
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

      // Arrowhead
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
   * Uses a wider dynamic range and smooth S-curve for
   * expressive thick↔thin transitions like real ink.
   */
  static getWidth(style: StrokeStyle, pressure: number): number {
    const minW = style.width * 0.25;  // thinner min for more contrast
    const maxW = style.width * 1.5;   // thicker max for expressiveness
    const t = Math.max(0.05, Math.min(1, pressure));
    // Smooth S-curve (hermite smoothstep) — natural ink feel
    // Slight bias toward medium width so light touches aren't invisible
    const s = t * t * (3 - 2 * t); // smoothstep
    // Blend 70% smoothstep + 30% linear for responsiveness
    const eased = s * 0.7 + t * 0.3;
    return minW + (maxW - minW) * eased;
  }
}
