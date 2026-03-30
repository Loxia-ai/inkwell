import { Point, Stroke, StrokeStyle } from '../types';
import getStroke from 'perfect-freehand';

/**
 * Inkwell Stroke Renderer — PencilKit-inspired algorithm
 *
 * Core principles (derived from Apple PencilKit WWDC sessions + perfect-freehand internals):
 *
 * 1. PRESSURE SMOOTHING
 *    Raw digitizer pressure jumps from 0→0.5 at stroke start and can spike.
 *    We apply exponential smoothing (α=0.15) so width transitions are gradual.
 *    This is what PencilKit does internally with its cubic Hermite pressure spline.
 *
 * 2. VELOCITY-BASED WIDTH MODULATION
 *    Fast strokes → thinner (pen lifts slightly at speed).
 *    Slow strokes → thicker (pen presses harder at rest).
 *    Combined with real pressure via: effectivePressure = lerp(velocityPressure, rawPressure, blend)
 *
 * 3. START/END TAPER (the zero-to-hero fix)
 *    The first ~30px and last ~20px of every stroke taper regardless of pressure.
 *    This eliminates the abrupt width jump at stroke start.
 *    perfect-freehand's `start.taper` and `end.taper` handle this.
 *
 * 4. ALWAYS PASS last:true TO perfect-freehand
 *    With last:false, pf renders an "open" end that looks like a blunt cut.
 *    With last:true, pf renders the stroke ending at the actual last point.
 *    We always use last:true — the live preview looks identical to the final stroke.
 *
 * 5. CORRECT SVG PATH RENDERING
 *    Using the official getSvgPathFromStroke from perfect-freehand's README:
 *    M→Q→T pattern with midpoint averaging for smooth quadratic curves.
 *    Our previous implementation used a different Q pattern that caused artifacts.
 */
export class StrokeRenderer {

  // ─── Official perfect-freehand SVG path ──────────────────────
  // This is the exact implementation from the perfect-freehand README.
  // It uses M→Q→T with midpoint averaging — the correct way to render
  // the outline polygon as a smooth closed path.

  private static getSvgPathFromStroke(pts: number[][], closed = true): string {
    const len = pts.length;
    if (len < 4) return '';

    let a = pts[0];
    let b = pts[1];
    const c = pts[2];

    const avg = (a: number, b: number) => (a + b) / 2;

    let result =
      `M ${a[0].toFixed(2)},${a[1].toFixed(2)} ` +
      `Q ${b[0].toFixed(2)},${b[1].toFixed(2)} ` +
      `${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;

    for (let i = 2; i < len - 1; i++) {
      a = pts[i];
      b = pts[i + 1];
      result += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
    }

    if (closed) result += 'Z';
    return result;
  }

  // ─── Pressure smoothing ───────────────────────────────────────
  /**
   * Apply exponential moving average to pressure values.
   * α=0.15 means each new value contributes 15% — strong smoothing.
   * This eliminates the 0→0.5 jump at stroke start.
   */
  static smoothPressure(points: Point[]): number[] {
    if (points.length === 0) return [];
    const α = 0.15;
    const smoothed: number[] = new Array(points.length);
    smoothed[0] = points[0].pressure;
    for (let i = 1; i < points.length; i++) {
      smoothed[i] = smoothed[i - 1] * (1 - α) + points[i].pressure * α;
    }
    return smoothed;
  }

  // ─── Velocity-based pressure simulation ──────────────────────
  /**
   * Compute velocity-based pressure: fast=thin, slow=thick.
   * Returns values in [0, 1] where 1 = maximum pressure (slow/stopped).
   */
  private static velocityPressure(points: Point[]): number[] {
    if (points.length === 0) return [];
    const result: number[] = new Array(points.length).fill(0.5);
    if (points.length < 2) return result;

    // Compute distances between consecutive points
    const dists: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      dists.push(Math.sqrt(dx * dx + dy * dy));
    }

    // Smooth distances (velocity proxy)
    const α = 0.2;
    const smoothDist: number[] = [dists[0]];
    for (let i = 1; i < dists.length; i++) {
      smoothDist.push(smoothDist[i - 1] * (1 - α) + dists[i] * α);
    }

    // Find max for normalization
    const maxDist = Math.max(...smoothDist, 1);

    // Convert velocity to pressure: fast (high dist) → low pressure
    for (let i = 0; i < points.length; i++) {
      const velocity = smoothDist[i] / maxDist; // 0=stopped, 1=fastest
      result[i] = Math.max(0.1, 1 - velocity * 0.6); // range [0.1, 1.0]
    }
    return result;
  }

  // ─── Build perfect-freehand input with smoothed pressure ─────
  /**
   * Convert Point[] to perfect-freehand [x, y, pressure] input.
   * Uses real pressure if available (Apple Pencil), blended with
   * velocity-based simulation for tools that report constant pressure.
   */
  private static buildInput(
    points: Point[],
    style: StrokeStyle
  ): [number, number, number][] {
    if (points.length === 0) return [];

    // Check if we have real pressure variation (Apple Pencil reports varied pressure)
    const pressures = points.map(p => p.pressure);
    const pMin = Math.min(...pressures);
    const pMax = Math.max(...pressures);
    const hasRealPressure = (pMax - pMin) > 0.05; // more than 5% variation

    const smoothed = StrokeRenderer.smoothPressure(points);
    const velocity = StrokeRenderer.velocityPressure(points);

    // For tools that don't use pressure variation, rely more on velocity
    const useVelocity = style.tool === 'pencil' || style.tool === 'pen' || style.tool === 'fountain';

    return points.map((p, i) => {
      let pressure: number;
      if (hasRealPressure) {
        // Blend smoothed real pressure with velocity (70/30)
        pressure = smoothed[i] * 0.7 + velocity[i] * 0.3;
      } else if (useVelocity) {
        // No real pressure — use velocity simulation
        pressure = velocity[i];
      } else {
        pressure = smoothed[i];
      }
      // Clamp to valid range
      pressure = Math.max(0.05, Math.min(1.0, pressure));
      return [p.x, p.y, pressure];
    });
  }

  // ─── perfect-freehand options per tool ────────────────────────
  private static getFreehandOptions(style: StrokeStyle, isLive: boolean) {
    // Start taper: always taper the first segment to avoid width jump at stroke start.
    // End taper: taper the end for a natural pen-lift feel.
    const startTaper = style.width * 4;  // ~4× width for natural start
    const endTaper = style.width * 2;    // ~2× width for natural end

    const base = {
      size: style.width * 2.0,
      smoothing: 0.5,
      thinning: 0.45,
      streamline: 0.3,       // low streamline = low lag = responsive
      easing: (t: number) => t * t * (3 - 2 * t), // smoothstep
      simulatePressure: false, // we supply our own blended pressure
      last: true,             // ALWAYS true — eliminates open-end artifacts
      start: { cap: true, taper: startTaper, easing: (t: number) => t * t },
      end:   { cap: true, taper: endTaper,   easing: (t: number) => Math.sqrt(t) },
    };

    switch (style.tool) {
      case 'pen':
        return {
          ...base,
          size: style.width * 2.0,
          thinning: 0.5,
          smoothing: 0.45,
          streamline: 0.25,
          start: { cap: true, taper: style.width * 5, easing: (t: number) => t * t },
          end:   { cap: true, taper: style.width * 2, easing: (t: number) => Math.sqrt(t) },
        };
      case 'pencil':
        return {
          ...base,
          size: style.width * 1.6,
          thinning: 0.6,
          smoothing: 0.55,
          streamline: 0.2,    // very responsive — pencil should feel immediate
          start: { cap: true, taper: style.width * 3, easing: (t: number) => t * t },
          end:   { cap: true, taper: style.width * 1.5, easing: (t: number) => Math.sqrt(t) },
        };
      case 'fountain':
        return {
          ...base,
          size: style.width * 2.5,
          thinning: 0.7,
          smoothing: 0.4,
          streamline: 0.3,
          start: { cap: false, taper: style.width * 8, easing: (t: number) => t * t * t },
          end:   { cap: false, taper: style.width * 5, easing: (t: number) => t * t },
        };
      default:
        return base;
    }
  }

  // ─── Gap interpolation ────────────────────────────────────────
  /**
   * Fill gaps > maxGap px between consecutive points.
   * Prevents missing segments when drawing fast.
   */
  static interpolatePoints(points: Point[], maxGap = 3): Point[] {
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

  // ─── Core freehand renderer ───────────────────────────────────
  private static renderFreehand(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle,
    isLive: boolean
  ): void {
    const filled = StrokeRenderer.interpolatePoints(points, 3);
    const input = StrokeRenderer.buildInput(filled, style);
    const opts = StrokeRenderer.getFreehandOptions(style, isLive);
    const outline = getStroke(input, opts);
    if (!outline.length) return;
    const pathStr = StrokeRenderer.getSvgPathFromStroke(outline);
    if (!pathStr) return;
    ctx.fill(new Path2D(pathStr));
  }

  // ─── Highlighter: Catmull-Rom, thick, multiply ────────────────
  private static renderHighlighter(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle
  ): void {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[Math.min(i + 1, points.length - 1)];
      const p3 = points[Math.min(i + 2, points.length - 1)];
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
        p2.x, p2.y
      );
    }
    ctx.stroke();
  }

  // ─── Calligraphy: angle-sensitive nib ────────────────────────
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
      const sa = Math.atan2(next.y - prev.y, next.x - prev.x);
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
      const sa = Math.atan2(next.y - prev.y, next.x - prev.x);
      const w = (minW + (maxW - minW) * Math.abs(Math.sin(sa - nibAngle))) / 2;
      const nx = Math.cos(nibAngle) * w;
      const ny = Math.sin(nibAngle) * w;
      ctx.lineTo(p.x - nx, p.y - ny);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ─── Marker: Catmull-Rom, thick, multiply ────────────────────
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
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
        p2.x, p2.y
      );
    }
    ctx.stroke();
  }

  // ─── Spray: seeded scatter dots ──────────────────────────────
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
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(angle) * dist, p.y + Math.sin(angle) * dist,
          0.5 + ((seed >>> 16) & 0xFF) / 255 * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ─── Shape rendering ─────────────────────────────────────────
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
      ctx.beginPath(); ctx.moveTo(s.startX, s.startY); ctx.lineTo(s.endX, s.endY); ctx.stroke();
    } else if (s.type === 'circle') {
      const cx = s.cx ?? (s.startX + s.endX) / 2;
      const cy = s.cy ?? (s.startY + s.endY) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(Math.abs(s.endX - s.startX) / 2, 1), Math.max(Math.abs(s.endY - s.startY) / 2, 1), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'rectangle') {
      ctx.strokeRect(Math.min(s.startX, s.endX), Math.min(s.startY, s.endY), Math.abs(s.endX - s.startX), Math.abs(s.endY - s.startY));
    } else if (s.type === 'arrow') {
      ctx.beginPath(); ctx.moveTo(s.startX, s.startY); ctx.lineTo(s.endX, s.endY); ctx.stroke();
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

  // ─── Style setup ─────────────────────────────────────────────
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
    }
  }

  // ─── Dot (single point) ──────────────────────────────────────
  private static renderDot(ctx: CanvasRenderingContext2D, point: Point, style: StrokeStyle): void {
    const r = StrokeRenderer.getWidth(style, point.pressure) / 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(r, 0.5), 0, Math.PI * 2);
    ctx.fillStyle = style.tool === 'eraser' ? 'rgba(0,0,0,1)' : style.color;
    ctx.fill();
  }

  // ─── Dispatch ────────────────────────────────────────────────
  private static dispatch(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    style: StrokeStyle,
    isLive: boolean
  ): void {
    switch (style.tool) {
      case 'pen':
      case 'pencil':
      case 'fountain':
        StrokeRenderer.renderFreehand(ctx, points, style, isLive);
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
        StrokeRenderer.renderFreehand(ctx, points, style, isLive);
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  static renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.shapeData) { StrokeRenderer.renderShape(ctx, stroke); return; }
    const { points, style } = stroke;
    if (points.length === 0) return;
    ctx.save();
    StrokeRenderer.applyStyle(ctx, style);
    if (points.length === 1) StrokeRenderer.renderDot(ctx, points[0], style);
    else StrokeRenderer.dispatch(ctx, points, style, false);
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
    if (points.length === 1) StrokeRenderer.renderDot(ctx, points[0], style);
    else StrokeRenderer.dispatch(ctx, points, style, true);
    ctx.restore();
  }

  // ─── Width helper (used by eraser and dot) ────────────────────
  static getWidth(style: StrokeStyle, pressure: number): number {
    const minW = style.width * 0.25;
    const maxW = style.width * 1.5;
    const t = Math.max(0.05, Math.min(1, pressure));
    const s = t * t * (3 - 2 * t);
    return minW + (maxW - minW) * (s * 0.7 + t * 0.3);
  }
}
