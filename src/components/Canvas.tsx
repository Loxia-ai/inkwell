import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useApp } from '../store/AppContext';
import { StrokeRenderer } from '../engine/StrokeRenderer';
import { ShapeRecognizer } from '../engine/ShapeRecognizer';
import { Point, Stroke, Bounds, PageImage, EraserMode } from '../types';
import { v4 as uuid } from 'uuid';

const BACKGROUND_COLORS: Record<string, string> = {
  blank: '#FAFAF8',
  lined: '#FAFAF8',
  grid: '#FAFAF8',
  dotted: '#FAFAF8',
  graph: '#FAFAF8',
  cornell: '#FAFAF8',
  isometric: '#FAFAF8',
  music: '#FAFAF8',
};

const LINE_SPACING = 32;
const GRID_SPACING = 32;
const DOT_SPACING = 32;
const GRAPH_SPACING = 20;
const MUSIC_STAFF_SPACING = 8;
const MUSIC_STAFF_GAP = 64;

// Cache for loaded images
const imageCache = new Map<string, HTMLImageElement>();

function getOrLoadImage(src: string): HTMLImageElement | null {
  if (imageCache.has(src)) {
    const img = imageCache.get(src)!;
    return img.complete ? img : null;
  }
  const img = new Image();
  img.src = src;
  imageCache.set(src, img);
  return img.complete ? img : null;
}

// ─── Image hit-testing helpers ─────────────────────────────

function hitTestImage(img: PageImage, cx: number, cy: number): boolean {
  // Transform point into image-local coordinates (accounting for rotation)
  const icx = img.x + img.width / 2;
  const icy = img.y + img.height / 2;
  const rad = -(img.rotation * Math.PI) / 180;
  const dx = cx - icx;
  const dy = cy - icy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return (
    Math.abs(lx) <= img.width / 2 + 10 &&
    Math.abs(ly) <= img.height / 2 + 10
  );
}

type ImageHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'rotate';

function hitTestImageHandle(img: PageImage, cx: number, cy: number): ImageHandle | null {
  const icx = img.x + img.width / 2;
  const icy = img.y + img.height / 2;
  const rad = -(img.rotation * Math.PI) / 180;
  const dx = cx - icx;
  const dy = cy - icy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

  const hw = img.width / 2;
  const hh = img.height / 2;
  const handleR = 16;

  // Rotation handle (above top center)
  if (Math.abs(lx) < handleR && Math.abs(ly + hh + 28) < handleR) return 'rotate';

  // Corner handles
  if (Math.abs(lx + hw) < handleR && Math.abs(ly + hh) < handleR) return 'nw';
  if (Math.abs(lx - hw) < handleR && Math.abs(ly + hh) < handleR) return 'ne';
  if (Math.abs(lx + hw) < handleR && Math.abs(ly - hh) < handleR) return 'sw';
  if (Math.abs(lx - hw) < handleR && Math.abs(ly - hh) < handleR) return 'se';

  // Body = move
  if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return 'move';

  return null;
}

export const Canvas: React.FC = () => {
  const { state, dispatch, getActivePage, getActiveNotebook, persistNotebook } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drawing state refs (not React state for perf)
  const isDrawing = useRef(false);
  const currentPoints = useRef<Point[]>([]);
  const activePointerId = useRef<number | null>(null);
  const lastRenderIndex = useRef(0);
  const rafId = useRef<number>(0);
  const needsLiveRender = useRef(false);
  const lastPointTime = useRef(0);
  const predictedPoint = useRef<Point | null>(null);
  // Track strokes erased during pixel-eraser drag
  const pixelErasedIds = useRef<Set<string>>(new Set());
  const pixelErasedStrokes = useRef<Stroke[]>([]);
  const pixelNewStrokes = useRef<Stroke[]>([]);

  // ── Committed strokes buffer ──────────────────────────────────────────
  // Strokes that have been immediately painted to the main canvas but may
  // not yet appear in page.strokes (React state is async). redrawAll()
  // renders these ON TOP of page.strokes so they survive full-canvas clears.
  // Once a stroke ID appears in page.strokes, it's pruned from this buffer.
  const committedStrokesRef = useRef<Stroke[]>([]);

  // Pinch/pan state
  const touchCache = useRef<Map<number, PointerEvent>>(new Map());
  const lastPinchDist = useRef<number | null>(null);
  const lastPanPos = useRef<{ x: number; y: number } | null>(null);
  const isPanning = useRef(false);
  const transformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });

  // Image manipulation state
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const imageManip = useRef<{
    handle: ImageHandle;
    imageId: string;
    startX: number;
    startY: number;
    origImage: PageImage;
  } | null>(null);

  // ─── Ruler projection helper ────────────────────────────────

  const projectToRulerLine = useCallback((px: number, py: number): { x: number; y: number } => {
    if (!state.ruler.visible) return { x: px, y: py };

    const { x: rx, y: ry, angle } = state.ruler;
    const t = transformRef.current;

    // Ruler position is in screen coords, convert to canvas coords
    const canvas = canvasRef.current;
    if (!canvas) return { x: px, y: py };
    const rect = canvas.getBoundingClientRect();
    const rulerCanvasX = (rx - rect.left - t.offsetX) / t.scale;
    // Ruler bottom edge — strokes draw along the lower edge like a physical ruler
    const rulerCanvasY = (ry + 48 - rect.top - t.offsetY) / t.scale;

    // Direction vector of the ruler line
    const rad = (angle * Math.PI) / 180;
    const dirX = Math.cos(rad);
    const dirY = Math.sin(rad);

    // Project point onto the ruler line
    const vx = px - rulerCanvasX;
    const vy = py - rulerCanvasY;
    const dot = vx * dirX + vy * dirY;

    return {
      x: rulerCanvasX + dirX * dot,
      y: rulerCanvasY + dirY * dot,
    };
  }, [state.ruler]);

  // ─── Background rendering ──────────────────────────────────

  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, bg: string) => {
    ctx.fillStyle = BACKGROUND_COLORS[bg] || '#FAFAF8';
    ctx.fillRect(0, 0, width, height);

    const t = transformRef.current;

    if (bg === 'lined') {
      ctx.strokeStyle = '#D5D5D3';
      ctx.lineWidth = 0.5;
      const startY = (t.offsetY % (LINE_SPACING * t.scale));
      for (let y = startY; y < height; y += LINE_SPACING * t.scale) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (bg === 'grid') {
      ctx.strokeStyle = '#E0E0DE';
      ctx.lineWidth = 0.5;
      const startX = (t.offsetX % (GRID_SPACING * t.scale));
      const startY = (t.offsetY % (GRID_SPACING * t.scale));
      for (let x = startX; x < width; x += GRID_SPACING * t.scale) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = startY; y < height; y += GRID_SPACING * t.scale) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (bg === 'dotted') {
      ctx.fillStyle = '#C8C8C6';
      const startX = (t.offsetX % (DOT_SPACING * t.scale));
      const startY = (t.offsetY % (DOT_SPACING * t.scale));
      for (let x = startX; x < width; x += DOT_SPACING * t.scale) {
        for (let y = startY; y < height; y += DOT_SPACING * t.scale) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (bg === 'graph') {
      const spacing = GRAPH_SPACING * t.scale;
      const startX = (t.offsetX % spacing);
      const startY = (t.offsetY % spacing);
      const majorEvery = 5;

      ctx.strokeStyle = '#E8E8E5';
      ctx.lineWidth = 0.3;
      for (let x = startX; x < width; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = startY; y < height; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const majorSpacing = spacing * majorEvery;
      const majorStartX = (t.offsetX % majorSpacing);
      const majorStartY = (t.offsetY % majorSpacing);
      ctx.strokeStyle = '#C8C8C4';
      ctx.lineWidth = 0.8;
      for (let x = majorStartX; x < width; x += majorSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = majorStartY; y < height; y += majorSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (bg === 'cornell') {
      const marginX = width * 0.30;
      const summaryY = height * 0.75;

      ctx.strokeStyle = '#D5D5D3';
      ctx.lineWidth = 0.5;
      const lineSpacing = LINE_SPACING * t.scale;
      const startY = (t.offsetY % lineSpacing);
      for (let y = startY; y < height; y += lineSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.strokeStyle = '#E85D5D';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(marginX, 0);
      ctx.lineTo(marginX, height);
      ctx.stroke();

      ctx.strokeStyle = '#E85D5D';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, summaryY);
      ctx.lineTo(width, summaryY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.font = `${11 * t.scale}px -apple-system, sans-serif`;
      ctx.fillText('Cues', 8, 16);
      ctx.fillText('Notes', marginX + 8, 16);
      ctx.fillText('Summary', 8, summaryY + 16);
    } else if (bg === 'isometric') {
      const spacing = 28 * t.scale;
      const h = spacing * Math.sqrt(3) / 2;
      ctx.strokeStyle = '#DDDDD8';
      ctx.lineWidth = 0.4;

      const startX = (t.offsetX % spacing) - spacing;
      const startY = (t.offsetY % (h * 2)) - h * 2;

      for (let y = startY; y < height + h; y += h) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      for (let x = startX - height; x < width + height; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, height + h);
        ctx.lineTo(x + height / Math.tan(Math.PI / 3), -h);
        ctx.stroke();
      }

      for (let x = startX - height; x < width + height; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, -h);
        ctx.lineTo(x + height / Math.tan(Math.PI / 3), height + h);
        ctx.stroke();
      }
    } else if (bg === 'music') {
      ctx.strokeStyle = '#B8B8B5';
      ctx.lineWidth = 0.6;
      const lineH = MUSIC_STAFF_SPACING * t.scale;
      const gapH = MUSIC_STAFF_GAP * t.scale;
      const staffHeight = lineH * 4;
      const totalBlock = staffHeight + gapH;
      const startY = (t.offsetY % totalBlock);

      for (let blockY = startY - totalBlock; blockY < height + totalBlock; blockY += totalBlock) {
        for (let line = 0; line < 5; line++) {
          const y = blockY + line * lineH;
          if (y > -10 && y < height + 10) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
          }
        }
      }
    }
  }, []);

  // ─── Render images on canvas ────────────────────────────────

  const drawImages = useCallback((ctx: CanvasRenderingContext2D, images: PageImage[], selId: string | null) => {
    for (const img of images) {
      const htmlImg = getOrLoadImage(img.src);
      if (!htmlImg) {
        const pending = imageCache.get(img.src);
        if (pending && !pending.complete) {
          pending.onload = () => redrawAll();
        }
        continue;
      }
      ctx.save();
      ctx.globalAlpha = img.opacity;
      const cx = img.x + img.width / 2;
      const cy = img.y + img.height / 2;
      if (img.rotation !== 0) {
        ctx.translate(cx, cy);
        ctx.rotate((img.rotation * Math.PI) / 180);
        ctx.drawImage(htmlImg, -img.width / 2, -img.height / 2, img.width, img.height);
      } else {
        ctx.drawImage(htmlImg, img.x, img.y, img.width, img.height);
      }

      // Draw selection handles if selected
      if (selId === img.id) {
        if (img.rotation === 0) {
          // Image was drawn without translate/rotate, so set up transform for handles
          ctx.translate(cx, cy);
        }
        // If rotation !== 0, context is already translated+rotated from drawing above
        const hw = img.width / 2;
        const hh = img.height / 2;

        // Selection border
        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(-hw, -hh, img.width, img.height);
        ctx.setLineDash([]);

        // Corner handles
        const corners = [
          [-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]
        ];
        for (const [hx, hy] of corners) {
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#007AFF';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(hx, hy, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Rotation handle (above top center)
        ctx.beginPath();
        ctx.moveTo(0, -hh);
        ctx.lineTo(0, -hh - 22);
        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -hh - 28, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#007AFF';
        ctx.fill();
      }

      ctx.restore();
    }
  }, []);

  // ─── Full redraw ───────────────────────────────────────────

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const page = getActivePage();
    if (!canvas || !page) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 2;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);

    // Only resize when dimensions actually changed.
    // Setting canvas.width/height unconditionally on every redraw:
    //   1. Resets the 2D context transform and state
    //   2. Forces GPU texture reallocation
    //   3. Creates a blank-canvas window during the reset — causing the
    //      second stroke of two-part letters (i, j, !, :) to disappear
    //      because redrawAll runs between stroke 2's commit and its
    //      appearance in page.strokes.
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    // Always reset transform and clear before redrawing
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawBackground(ctx, rect.width, rect.height, page.background);

    const t = transformRef.current;
    ctx.save();
    ctx.translate(t.offsetX, t.offsetY);
    ctx.scale(t.scale, t.scale);

    drawImages(ctx, page.images, selectedImageId);

    // Build a set of stroke IDs already in React state for fast lookup
    const stateStrokeIds = new Set<string>();
    for (const stroke of page.strokes) {
      stateStrokeIds.add(stroke.id);
      StrokeRenderer.renderStroke(ctx, stroke);
    }

    // ── Render committed buffer strokes ──────────────────────────────────
    // These are strokes that were immediately painted but may not yet be in
    // page.strokes due to React's async batching. We render them here so
    // they survive the full-canvas clear that redrawAll() just did.
    // Prune any that have already appeared in page.strokes.
    const pending: Stroke[] = [];
    for (const stroke of committedStrokesRef.current) {
      if (!stateStrokeIds.has(stroke.id)) {
        StrokeRenderer.renderStroke(ctx, stroke);
        pending.push(stroke);
      }
    }
    committedStrokesRef.current = pending;

    ctx.restore();
  }, [getActivePage, drawBackground, drawImages, selectedImageId]);

  // ─── Resize handling ───────────────────────────────────────

  // Initialize overlay canvas to correct physical pixel size.
  // This must happen on mount and on resize — NOT on every pointerDown.
  // Setting canvas.width/height resets the 2D context transform, so doing
  // it on every stroke start was causing the fast letter-to-letter miss.
  const initOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const dpr = window.devicePixelRatio || 2;
    const rect = overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Only resize if dimensions actually changed (avoids unnecessary context reset)
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (overlay.width !== targetW || overlay.height !== targetH) {
      overlay.width = targetW;
      overlay.height = targetH;
    }
  }, []);

  useEffect(() => {
    const handleResize = () => { initOverlay(); redrawAll(); };
    // Initialize immediately on mount
    initOverlay();
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
    };
  }, [redrawAll, initOverlay]);

  useEffect(() => {
    redrawAll();
  }, [state.activeNotebookId, state.activePageIndex, state.notebooks, redrawAll]);

  // ─── Coordinate transform ─────────────────────────────────

  const screenToCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.offsetX) / t.scale,
      y: (clientY - rect.top - t.offsetY) / t.scale,
    };
  }, []);

  // ─── Pixel eraser ──────────────────────────────────────────

  const performPixelErase = useCallback((eraserPoint: Point) => {
    const page = getActivePage();
    if (!page) return;
    const eraserRadius = state.strokeStyle.width * 2;
    const r2 = eraserRadius * eraserRadius;

    for (const stroke of page.strokes) {
      if (pixelErasedIds.current.has(stroke.id)) continue;
      if (stroke.shapeData) {
        if (
          eraserPoint.x >= stroke.bounds.minX - eraserRadius &&
          eraserPoint.x <= stroke.bounds.maxX + eraserRadius &&
          eraserPoint.y >= stroke.bounds.minY - eraserRadius &&
          eraserPoint.y <= stroke.bounds.maxY + eraserRadius
        ) {
          pixelErasedIds.current.add(stroke.id);
          pixelErasedStrokes.current.push(stroke);
        }
        continue;
      }

      const hitIndices = new Set<number>();
      for (let i = 0; i < stroke.points.length; i++) {
        const sp = stroke.points[i];
        const dx = eraserPoint.x - sp.x;
        const dy = eraserPoint.y - sp.y;
        if (dx * dx + dy * dy < r2) {
          hitIndices.add(i);
        }
      }

      if (hitIndices.size === 0) continue;

      if (hitIndices.size >= stroke.points.length) {
        pixelErasedIds.current.add(stroke.id);
        pixelErasedStrokes.current.push(stroke);
        continue;
      }

      pixelErasedIds.current.add(stroke.id);
      pixelErasedStrokes.current.push(stroke);

      const segments: Point[][] = [];
      let currentSeg: Point[] = [];
      for (let i = 0; i < stroke.points.length; i++) {
        if (hitIndices.has(i)) {
          if (currentSeg.length >= 2) segments.push(currentSeg);
          currentSeg = [];
        } else {
          currentSeg.push(stroke.points[i]);
        }
      }
      if (currentSeg.length >= 2) segments.push(currentSeg);

      for (const seg of segments) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of seg) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        pixelNewStrokes.current.push({
          id: uuid(),
          points: seg,
          style: { ...stroke.style },
          bounds: { minX, minY, maxX, maxY },
        });
      }
    }

    if (pixelErasedStrokes.current.length > 0) {
      redrawAll();
    }
  }, [getActivePage, state.strokeStyle.width, redrawAll]);

  // ─── Finish current stroke ─────────────────────────────────

  const finishStroke = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    activePointerId.current = null;
    predictedPoint.current = null;

    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    needsLiveRender.current = false;

    // Snapshot points immediately — currentPoints.current will be reset by the
    // next pointerDown before React processes the dispatch. Taking a reference
    // here ensures we always commit the correct set of points even if a new
    // stroke starts before the React render cycle completes.
    const points = [...currentPoints.current];
    currentPoints.current = []; // clear immediately so next stroke starts fresh

    const page = getActivePage();
    if (!page) return;

    if (points.length === 0) return;

    // Clear overlay using physical pixel dimensions (not CSS px — they differ on Retina)
    const overlay = overlayRef.current;
    if (overlay) {
      const octx = overlay.getContext('2d');
      if (octx) {
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, overlay.width, overlay.height);
        // Restore DPR scale for any subsequent drawing
        const dpr = window.devicePixelRatio || 2;
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    if (state.activeTool === 'eraser') {
      commitEraser(page, points);
      return;
    }

    let shapeData = undefined;
    if (state.activeTool === 'shape') {
      const first = points[0];
      const last = points[points.length - 1];
      shapeData = ShapeRecognizer.createShape(
        state.activeShape, first.x, first.y, last.x, last.y
      );
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const stroke: Stroke = {
      id: uuid(),
      points: shapeData ? [] : points,
      style: { ...state.strokeStyle },
      bounds: { minX, minY, maxX, maxY },
      shapeData,
    };

    // ── COMMITTED STROKES BUFFER ─────────────────────────────────────────────
    // Push the stroke into the committed buffer BEFORE dispatching to React.
    // redrawAll() renders these on top of page.strokes so they survive the
    // full-canvas clear that React's re-render triggers. Without this, fast
    // strokes (second line of 'x', dots of 'i') get wiped when redrawAll()
    // fires for a PREVIOUS stroke's state update and clears the canvas.
    committedStrokesRef.current.push(stroke);

    // Also paint immediately so the stroke is visible without waiting for rAF
    const mainCanvas = canvasRef.current;
    if (mainCanvas) {
      const ctx = mainCanvas.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 2;
        const t = transformRef.current;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(t.offsetX, t.offsetY);
        ctx.scale(t.scale, t.scale);
        StrokeRenderer.renderStroke(ctx, stroke);
        ctx.restore();
      }
    }

    // Dispatch to React for persistence/undo — canvas doesn't wait for this
    dispatch({ type: 'PUSH_HISTORY', entry: { type: 'add', pageId: page.id, strokes: [stroke] } });
    dispatch({ type: 'ADD_STROKE', pageId: page.id, stroke });

    const nb = getActiveNotebook();
    if (nb) persistNotebook(nb);
  }, [state.activeTool, state.activeShape, state.strokeStyle, getActivePage, getActiveNotebook, dispatch, persistNotebook]);

  // ─── Commit eraser ─────────────────────────────────────────

  const commitEraser = useCallback((page: NonNullable<ReturnType<typeof getActivePage>>, points: Point[]) => {
    const mode = state.eraserMode;

    if (mode === 'pixel') {
      const erasedIds = Array.from(pixelErasedIds.current);
      if (erasedIds.length > 0) {
        dispatch({ type: 'PUSH_HISTORY', entry: { type: 'remove', pageId: page.id, strokes: [...pixelErasedStrokes.current] } });
        dispatch({ type: 'REMOVE_STROKES', pageId: page.id, strokeIds: erasedIds });
        for (const ns of pixelNewStrokes.current) {
          dispatch({ type: 'ADD_STROKE', pageId: page.id, stroke: ns });
        }
        const nb = getActiveNotebook();
        if (nb) persistNotebook(nb);
      }
      pixelErasedIds.current.clear();
      pixelErasedStrokes.current = [];
      pixelNewStrokes.current = [];
      return;
    }

    if (mode === 'selection') {
      if (points.length < 3) return;

      const isInsideLasso = (px: number, py: number): boolean => {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const xi = points[i].x, yi = points[i].y;
          const xj = points[j].x, yj = points[j].y;
          if (((yi > py) !== (yj > py)) &&
              (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
            inside = !inside;
          }
        }
        return inside;
      };

      const removedStrokes: Stroke[] = [];
      const removedIds: string[] = [];

      for (const stroke of page.strokes) {
        let inside = false;
        if (stroke.shapeData) {
          const cx = (stroke.bounds.minX + stroke.bounds.maxX) / 2;
          const cy = (stroke.bounds.minY + stroke.bounds.maxY) / 2;
          inside = isInsideLasso(cx, cy);
        } else {
          let insideCount = 0;
          const checkEvery = Math.max(1, Math.floor(stroke.points.length / 10));
          for (let i = 0; i < stroke.points.length; i += checkEvery) {
            if (isInsideLasso(stroke.points[i].x, stroke.points[i].y)) {
              insideCount++;
            }
          }
          const totalChecked = Math.ceil(stroke.points.length / checkEvery);
          inside = insideCount > totalChecked * 0.3;
        }

        if (inside) {
          removedStrokes.push(stroke);
          removedIds.push(stroke.id);
        }
      }

      if (removedIds.length > 0) {
        dispatch({ type: 'PUSH_HISTORY', entry: { type: 'remove', pageId: page.id, strokes: removedStrokes } });
        dispatch({ type: 'REMOVE_STROKES', pageId: page.id, strokeIds: removedIds });
        const nb = getActiveNotebook();
        if (nb) persistNotebook(nb);
      }
      return;
    }

    const eraserRadius = state.strokeStyle.width * 2;
    const removedStrokes: Stroke[] = [];
    const removedIds: string[] = [];

    for (const stroke of page.strokes) {
      let hit = false;
      for (const ep of points) {
        if (stroke.shapeData) {
          if (
            ep.x >= stroke.bounds.minX - eraserRadius &&
            ep.x <= stroke.bounds.maxX + eraserRadius &&
            ep.y >= stroke.bounds.minY - eraserRadius &&
            ep.y <= stroke.bounds.maxY + eraserRadius
          ) { hit = true; break; }
        } else {
          for (const sp of stroke.points) {
            const dx = ep.x - sp.x;
            const dy = ep.y - sp.y;
            if (dx * dx + dy * dy < eraserRadius * eraserRadius) {
              hit = true; break;
            }
          }
        }
        if (hit) break;
      }
      if (hit) {
        removedStrokes.push(stroke);
        removedIds.push(stroke.id);
      }
    }

    if (removedIds.length > 0) {
      dispatch({ type: 'PUSH_HISTORY', entry: { type: 'remove', pageId: page.id, strokes: removedStrokes } });
      dispatch({ type: 'REMOVE_STROKES', pageId: page.id, strokeIds: removedIds });
      const nb = getActiveNotebook();
      if (nb) persistNotebook(nb);
    }
  }, [state.eraserMode, state.strokeStyle.width, getActiveNotebook, dispatch, persistNotebook]);

  // ─── Apply ruler constraint to a point ─────────────────────

  const constrainPoint = useCallback((x: number, y: number): { x: number; y: number } => {
    if (state.ruler.visible) {
      return projectToRulerLine(x, y);
    }
    return { x, y };
  }, [state.ruler.visible, projectToRulerLine]);

  // ─── Pointer handlers ─────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Palm rejection: touch → pinch/pan only
    if (state.palmRejection && e.pointerType === 'touch' && state.activeTool !== 'lasso') {
      touchCache.current.set(e.pointerId, e.nativeEvent);
      if (touchCache.current.size === 2) {
        // Two fingers: start pinch — abort any active drawing stroke first
        if (isDrawing.current && currentPoints.current.length >= 2) {
          finishStroke();
        } else if (isDrawing.current) {
          isDrawing.current = false;
          activePointerId.current = null;
        }
        const pts = Array.from(touchCache.current.values());
        lastPinchDist.current = Math.hypot(
          pts[1].clientX - pts[0].clientX,
          pts[1].clientY - pts[0].clientY
        );
        lastPanPos.current = {
          x: (pts[0].clientX + pts[1].clientX) / 2,
          y: (pts[0].clientY + pts[1].clientY) / 2,
        };
        isPanning.current = false;
      } else if (touchCache.current.size === 1) {
        // Single finger: start pan
        isPanning.current = true;
        lastPanPos.current = { x: e.clientX, y: e.clientY };
      }
      return;
    }
    // Non-touch (pen/mouse): clear any stale touch pan state so it doesn't
    // interfere with the pointer-move handler for drawing.
    if (e.pointerType !== 'touch') {
      isPanning.current = false;
    }

    // Check if clicking on an image for manipulation
    const page = getActivePage();
    if (page && page.images.length > 0) {
      const pos = screenToCanvas(e.clientX, e.clientY);

      // Check selected image handles first
      if (selectedImageId) {
        const selImg = page.images.find(img => img.id === selectedImageId);
        if (selImg) {
          const handle = hitTestImageHandle(selImg, pos.x, pos.y);
          if (handle) {
            imageManip.current = {
              handle,
              imageId: selImg.id,
              startX: pos.x,
              startY: pos.y,
              origImage: { ...selImg },
            };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            activePointerId.current = e.pointerId;
            return;
          }
        }
      }

      // Check if clicking on any image (reverse order for top-most)
      for (let i = page.images.length - 1; i >= 0; i--) {
        if (hitTestImage(page.images[i], pos.x, pos.y)) {
          setSelectedImageId(page.images[i].id);
          imageManip.current = {
            handle: 'move',
            imageId: page.images[i].id,
            startX: pos.x,
            startY: pos.y,
            origImage: { ...page.images[i] },
          };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          activePointerId.current = e.pointerId;
          return;
        }
      }

      // Clicked empty area — deselect image.
      // Use a ref-based flag instead of setState to avoid triggering a React
      // re-render mid-pointerDown which can cause stale closure issues.
      if (selectedImageId) {
        // Defer deselection to after drawing starts to avoid re-render race
        setTimeout(() => setSelectedImageId(null), 0);
      }
    }

    // Normal drawing
    // If a stroke is in progress when a new pointerDown arrives, ALWAYS finish it
    // and start the new stroke. Do NOT check pointer IDs here.
    //
    // Rationale: On iPad with fast writing, the OS can assign a new pointer ID
    // for the second stroke before the first pointerUp arrives. The old guard
    // `if (activePointerId !== e.pointerId) return` was blocking these strokes.
    // Touch events are already filtered by palm rejection above, so we never
    // reach this code for touch — only pen and mouse, which are always 1 active
    // pointer at a time.
    if (isDrawing.current) {
      finishStroke();
    }
    // Clear any stale activePointerId (e.g. from image manipulation)
    activePointerId.current = null;

    isDrawing.current = true;
    activePointerId.current = e.pointerId;
    currentPoints.current = [];
    lastRenderIndex.current = 0;
    pixelErasedIds.current.clear();
    pixelErasedStrokes.current = [];
    pixelNewStrokes.current = [];

    const pos = screenToCanvas(e.clientX, e.clientY);
    const constrained = constrainPoint(pos.x, pos.y);
    const point: Point = {
      x: constrained.x,
      y: constrained.y,
      pressure: e.pressure || 0.5,
      timestamp: Date.now(),
    };
    currentPoints.current.push(point);
    lastPointTime.current = point.timestamp;
    predictedPoint.current = null;

    // Do NOT resize the overlay canvas here — resizing resets the 2D context
    // transform and causes rendering glitches on fast consecutive strokes.
    // The overlay is resized only by the ResizeObserver when the container changes.

    if (state.activeTool === 'eraser' && state.eraserMode === 'pixel') {
      performPixelErase(point);
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [state.palmRejection, state.activeTool, state.eraserMode, screenToCanvas, finishStroke, performPixelErase, constrainPoint, getActivePage, selectedImageId]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Handle touch pan/pinch
    if (state.palmRejection && e.pointerType === 'touch') {
      touchCache.current.set(e.pointerId, e.nativeEvent);

      if (touchCache.current.size === 2 && lastPinchDist.current !== null) {
        // Two-finger pinch-zoom at touch origin
        const pts = Array.from(touchCache.current.values());
        const dist = Math.hypot(
          pts[1].clientX - pts[0].clientX,
          pts[1].clientY - pts[0].clientY
        );
        const center = {
          x: (pts[0].clientX + pts[1].clientX) / 2,
          y: (pts[0].clientY + pts[1].clientY) / 2,
        };

        const scaleDelta = dist / lastPinchDist.current;
        const t = transformRef.current;
        const newScale = Math.min(5, Math.max(0.25, t.scale * scaleDelta));

        // Zoom around the pinch center (touch origin), not the canvas center
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const pinchScreenX = center.x - rect.left;
          const pinchScreenY = center.y - rect.top;

          // The canvas point under the pinch center should stay fixed
          const newOffsetX = pinchScreenX - (pinchScreenX - t.offsetX) * (newScale / t.scale);
          const newOffsetY = pinchScreenY - (pinchScreenY - t.offsetY) * (newScale / t.scale);

          // Also apply pan movement
          const panDx = lastPanPos.current ? center.x - lastPanPos.current.x : 0;
          const panDy = lastPanPos.current ? center.y - lastPanPos.current.y : 0;

          transformRef.current = {
            offsetX: newOffsetX + panDx,
            offsetY: newOffsetY + panDy,
            scale: newScale,
          };
        }

        lastPinchDist.current = dist;
        lastPanPos.current = center;
        isPanning.current = false;
        redrawAll();
      } else if (touchCache.current.size === 1 && isPanning.current && lastPanPos.current) {
        // Single-finger pan
        const panDx = e.clientX - lastPanPos.current.x;
        const panDy = e.clientY - lastPanPos.current.y;
        const t = transformRef.current;
        transformRef.current = {
          offsetX: t.offsetX + panDx,
          offsetY: t.offsetY + panDy,
          scale: t.scale,
        };
        lastPanPos.current = { x: e.clientX, y: e.clientY };
        redrawAll();
      }
      return;
    }

    // Image manipulation
    if (imageManip.current && e.pointerId === activePointerId.current) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      const m = imageManip.current;
      const page = getActivePage();
      if (!page) return;

      const dx = pos.x - m.startX;
      const dy = pos.y - m.startY;

      if (m.handle === 'move') {
        dispatch({
          type: 'UPDATE_IMAGE',
          pageId: page.id,
          imageId: m.imageId,
          updates: {
            x: m.origImage.x + dx,
            y: m.origImage.y + dy,
          },
        });
      } else if (m.handle === 'rotate') {
        const icx = m.origImage.x + m.origImage.width / 2;
        const icy = m.origImage.y + m.origImage.height / 2;
        const startAngle = Math.atan2(m.startY - icy, m.startX - icx);
        const currAngle = Math.atan2(pos.y - icy, pos.x - icx);
        let newRot = m.origImage.rotation + (currAngle - startAngle) * (180 / Math.PI);
        // Snap to 0/90/180/270
        const snapAngles = [0, 90, 180, 270, -90, -180, -270];
        for (const sa of snapAngles) {
          if (Math.abs(newRot - sa) < 5) { newRot = sa; break; }
        }
        dispatch({
          type: 'UPDATE_IMAGE',
          pageId: page.id,
          imageId: m.imageId,
          updates: { rotation: newRot },
        });
      } else {
        // Corner resize (nw, ne, sw, se)
        const icx = m.origImage.x + m.origImage.width / 2;
        const icy = m.origImage.y + m.origImage.height / 2;
        const startDist = Math.hypot(m.startX - icx, m.startY - icy);
        const currDist = Math.hypot(pos.x - icx, pos.y - icy);
        const scaleFactor = startDist > 10 ? currDist / startDist : 1;
        const newW = Math.max(20, m.origImage.width * scaleFactor);
        const newH = Math.max(20, m.origImage.height * scaleFactor);
        dispatch({
          type: 'UPDATE_IMAGE',
          pageId: page.id,
          imageId: m.imageId,
          updates: {
            x: icx - newW / 2,
            y: icy - newH / 2,
            width: newW,
            height: newH,
          },
        });
      }
      return;
    }

    // ── Pressure-based stroke detection (consultant-recommended pattern) ────
    // iPadOS WebKit has a known quirk: after a hover transition, it fires a
    // spurious pointerUp (buttons=0, pressure=0) and then suppresses the next
    // pointerDown. GoodNotes/Procreate solve this by NOT relying on pointerDown
    // to start strokes — instead they watch for pressure >= threshold on
    // pointerMove with buttons=1 (pen tip touching screen).
    //
    // Rule: pen is touching the screen ↔ (buttons === 1 AND pressure >= 0.05)
    // Rule: pen is hovering           ↔ (buttons === 0 OR pressure < 0.05)
    //
    // Filter hover moves — never draw ink when pen is not touching
    if (e.pointerType === 'pen' && (e.buttons === 0 || e.pressure < 0.02)) return;

    // Auto-start stroke from pointermove if pen is touching but isDrawing=false.
    // This is the fallback for when pointerDown was suppressed by iPadOS after
    // a hover transition. The stroke starts the moment pressure is detected.
    if (!isDrawing.current && e.pointerType === 'pen' && e.buttons === 1 && e.pressure >= 0.05) {
      // Start a new stroke here — same logic as handlePointerDown
      isDrawing.current = true;
      activePointerId.current = e.pointerId;
      currentPoints.current = [];
      lastRenderIndex.current = 0;
      pixelErasedIds.current.clear();
      pixelErasedStrokes.current = [];
      pixelNewStrokes.current = [];
      lastPointTime.current = Date.now();
      predictedPoint.current = null;
      // Capture the pointer so subsequent events route here
      try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    // If still not drawing after auto-start attempt, bail
    if (!isDrawing.current) return;

    // Adopt new pointer ID if it changed mid-stroke (iPadOS reassignment)
    if (e.pointerId !== activePointerId.current) {
      if (e.pointerType !== 'touch') {
        activePointerId.current = e.pointerId;
      } else {
        return;
      }
    }

    const coalesced = (e.nativeEvent as any).getCoalescedEvents?.() || [];
    const predicted = (e.nativeEvent as any).getPredictedEvents?.() || [];
    const now = Date.now();

    if (coalesced.length > 0) {
      for (const ce of coalesced) {
        const cp = screenToCanvas(ce.clientX, ce.clientY);
        const constrained = constrainPoint(cp.x, cp.y);
        const newPt: Point = {
          x: constrained.x,
          y: constrained.y,
          pressure: ce.pressure || 0.5,
          timestamp: ce.timeStamp ? Math.round(ce.timeStamp) : now,
        };
        const pts = currentPoints.current;
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          const ddx = newPt.x - last.x;
          const ddy = newPt.y - last.y;
          // Only skip truly identical points (< 0.1px) — not 0.5px.
          // The 0.5px threshold was dropping valid points from slow/precise drawing.
          if (ddx * ddx + ddy * ddy < 0.01) continue;
        }
        currentPoints.current.push(newPt);
      }
    } else {
      const pos = screenToCanvas(e.clientX, e.clientY);
      const constrained = constrainPoint(pos.x, pos.y);
      const newPt: Point = {
        x: constrained.x,
        y: constrained.y,
        pressure: e.pressure || 0.5,
        timestamp: now,
      };
      const pts = currentPoints.current;
      if (pts.length > 0) {
        const last = pts[pts.length - 1];
        const ddx = newPt.x - last.x;
        const ddy = newPt.y - last.y;
        // Only skip truly identical points (< 0.1px)
        if (ddx * ddx + ddy * ddy >= 0.01) {
          currentPoints.current.push(newPt);
        }
      } else {
        currentPoints.current.push(newPt);
      }
    }

    if (predicted.length > 0) {
      const pe = predicted[0];
      const pp = screenToCanvas(pe.clientX, pe.clientY);
      const constrained = constrainPoint(pp.x, pp.y);
      predictedPoint.current = {
        x: constrained.x,
        y: constrained.y,
        pressure: pe.pressure || 0.5,
        timestamp: now,
      };
    } else {
      predictedPoint.current = null;
    }

    lastPointTime.current = now;

    if (state.activeTool === 'eraser' && state.eraserMode === 'pixel') {
      const lastPt = currentPoints.current[currentPoints.current.length - 1];
      if (lastPt) performPixelErase(lastPt);
    }

    needsLiveRender.current = true;
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        if (!needsLiveRender.current) return;
        needsLiveRender.current = false;

        const overlay = overlayRef.current;
        if (!overlay) return;
        const octx = overlay.getContext('2d');
        if (!octx) return;
        // Use physical pixel dimensions for clearRect (canvas.width/height are in
        // physical pixels after initOverlay sets them with dpr scaling).
        // We must reset the transform before clearing, then re-apply dpr scale.
        const dpr = window.devicePixelRatio || 2;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, overlay.width, overlay.height);
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (state.activeTool === 'shape') {
          // (clearRect already done above)
          octx.save();
          const t = transformRef.current;
          octx.translate(t.offsetX, t.offsetY);
          octx.scale(t.scale, t.scale);
          const first = currentPoints.current[0];
          const last = currentPoints.current[currentPoints.current.length - 1];
          const shapeData = ShapeRecognizer.createShape(
            state.activeShape, first.x, first.y, last.x, last.y
          );
          const previewStroke: Stroke = {
            id: 'preview',
            points: [],
            style: state.strokeStyle,
            bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
            shapeData,
          };
          StrokeRenderer.renderStroke(octx, previewStroke);
          octx.restore();
        } else if (state.activeTool === 'eraser') {
          // clearRect already done above
          if (state.eraserMode === 'selection' && currentPoints.current.length > 1) {
            octx.save();
            const t = transformRef.current;
            octx.translate(t.offsetX, t.offsetY);
            octx.scale(t.scale, t.scale);
            octx.beginPath();
            octx.moveTo(currentPoints.current[0].x, currentPoints.current[0].y);
            for (let i = 1; i < currentPoints.current.length; i++) {
              octx.lineTo(currentPoints.current[i].x, currentPoints.current[i].y);
            }
            octx.closePath();
            octx.strokeStyle = 'rgba(255, 59, 48, 0.7)';
            octx.lineWidth = 1.5 / t.scale;
            octx.setLineDash([6 / t.scale, 4 / t.scale]);
            octx.stroke();
            octx.fillStyle = 'rgba(255, 59, 48, 0.08)';
            octx.fill();
            octx.restore();
          }
        } else {
          // clearRect already done above
          octx.save();
          const t = transformRef.current;
          octx.translate(t.offsetX, t.offsetY);
          octx.scale(t.scale, t.scale);

          const renderPoints = predictedPoint.current
            ? [...currentPoints.current, predictedPoint.current]
            : currentPoints.current;

          StrokeRenderer.renderStrokeLive(
            octx,
            renderPoints,
            state.strokeStyle,
            0
          );
          octx.restore();
        }
      });
    }
  }, [state.palmRejection, state.activeTool, state.eraserMode, state.activeShape, state.strokeStyle, screenToCanvas, redrawAll, performPixelErase, constrainPoint, getActivePage, dispatch, selectedImageId]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    touchCache.current.delete(e.pointerId);
    if (touchCache.current.size < 2) {
      lastPinchDist.current = null;
    }
    if (touchCache.current.size === 0) {
      lastPanPos.current = null;
      isPanning.current = false;
    }

    // Finish image manipulation
    if (imageManip.current && e.pointerId === activePointerId.current) {
      imageManip.current = null;
      activePointerId.current = null;
      const nb = getActiveNotebook();
      if (nb) persistNotebook(nb);
      return;
    }

    // Ghost pointerUp detection:
    // iPadOS fires pointerUp with buttons=0 AND pressure=0 when the pen
    // transitions to hover state (not actually lifted). This is NOT a real
    // pen lift — it's the OS signaling hover mode. If we commit the stroke
    // here, no further pointerDown will fire (the OS considers the pen still
    // "connected") and the next segment is lost.
    //
    // Detection: pen pointerUp during active drawing with buttons=0 AND pressure=0
    // Real lifts have pressure>0 on the last move before up, and buttons may vary.
    // Ghost ups always have both buttons=0 AND pressure=0 simultaneously.
    //
    // Fix: ignore ghost ups — keep isDrawing=true so the stroke continues
    // when the pen touches down again. The stroke will be committed on the
    // next real pointerUp (pressure>0 or buttons>0) or pointerCancel.
    if (isDrawing.current &&
        e.pointerType === 'pen' &&
        e.buttons === 0 &&
        e.pressure === 0 &&
        currentPoints.current.length > 0) {
      // This is a ghost up — pen is hovering, not lifted.
      // Log it in diagnostics but do NOT commit the stroke.
      // The stroke remains active and will continue on next pointerDown/Move.
      return;
    }

    // Finish if this is our active pointer OR if it's a stale up from the
    // previous stroke (fast writing: old UP arrives after new DOWN already started).
    // In the stale case, isDrawing is true but for the NEW pointer — don't finish.
    if (!isDrawing.current) return;
    if (e.pointerId === activePointerId.current) {
      finishStroke();
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    // If e.pointerId !== activePointerId, this is a stale UP from the previous
    // stroke — the new stroke is already running, so we correctly ignore it.
  }, [finishStroke, getActiveNotebook, persistNotebook]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    touchCache.current.delete(e.pointerId);
    if (touchCache.current.size === 0) {
      isPanning.current = false;
      lastPanPos.current = null;
    }
    // Clean up image manipulation
    if (imageManip.current && e.pointerId === activePointerId.current) {
      imageManip.current = null;
      activePointerId.current = null;
      return;
    }
    if (e.pointerId === activePointerId.current) {
      // Bug fix: if we have enough points, SAVE the stroke instead of discarding it.
      // pointercancel fires when the OS interrupts (palm contact, system gestures, etc.)
      // — the user DID draw those points and expects them to be committed.
      if (isDrawing.current && currentPoints.current.length >= 2) {
        finishStroke();
        return;
      }
      // Not enough points — just clean up
      isDrawing.current = false;
      activePointerId.current = null;
      predictedPoint.current = null;
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = 0;
      }
      needsLiveRender.current = false;
      const overlay = overlayRef.current;
      if (overlay) {
        const octx = overlay.getContext('2d');
        if (octx) {
          const rect = overlay.getBoundingClientRect();
          octx.clearRect(0, 0, rect.width, rect.height);
        }
      }
    }
  }, [finishStroke]);

  // ─── Ruler overlay ─────────────────────────────────────────

  const renderRuler = useCallback(() => {
    if (!state.ruler.visible) return null;
    const { x, y, angle, length } = state.ruler;

    return (
      <div
        className="ruler-overlay"
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: length,
          height: 48,
          transform: `rotate(${angle}deg)`,
          transformOrigin: '0 50%',
          background: 'rgba(255, 204, 0, 0.15)',
          border: '1px solid rgba(255, 204, 0, 0.6)',
          borderRadius: 4,
          backdropFilter: 'blur(4px)',
          cursor: 'move',
          touchAction: 'none',
          pointerEvents: 'auto',
          zIndex: 10,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const origX = state.ruler.x;
          const origY = state.ruler.y;

          const onMove = (me: PointerEvent) => {
            dispatch({ type: 'SET_RULER_POSITION', x: origX + (me.clientX - startX), y: origY + (me.clientY - startY) });
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }}
      >
        <svg width={length} height={48} style={{ position: 'absolute', top: 0, left: 0 }}>
          {Array.from({ length: Math.floor(length / 32) + 1 }, (_, i) => (
            <React.Fragment key={i}>
              <line x1={i * 32} y1={36} x2={i * 32} y2={48} stroke="rgba(0,0,0,0.3)" strokeWidth={1} />
              {i % 2 === 0 && (
                <text x={i * 32 + 2} y={34} fontSize={9} fill="rgba(0,0,0,0.4)">{i}</text>
              )}
            </React.Fragment>
          ))}
        </svg>
        <div
          style={{
            position: 'absolute',
            right: -12,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'rgba(255, 204, 0, 0.8)',
            cursor: 'grab',
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            const rulerX = state.ruler.x;
            const rulerY = state.ruler.y + 24;

            const onMove = (me: PointerEvent) => {
              const ddx = me.clientX - rulerX;
              const ddy = me.clientY - rulerY;
              let ang = Math.atan2(ddy, ddx) * (180 / Math.PI);
              const snapAngles = [0, 45, 90, 135, 180, -45, -90, -135];
              for (const sa of snapAngles) {
                if (Math.abs(ang - sa) < 5) {
                  ang = sa;
                  break;
                }
              }
              dispatch({ type: 'SET_RULER_ANGLE', angle: ang });
            };
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }}
        />
      </div>
    );
  }, [state.ruler, dispatch]);

  // ─── Pen Diagnostics ──────────────────────────────────────

  const [diagVisible, setDiagVisible] = useState(false);
  const diagEventsRef = useRef<Array<{
    t: number; type: string; pointerId: number; pointerType: string;
    pressure: number; buttons: number; isPrimary: boolean;
    width: number; height: number; tiltX: number; tiltY: number;
    twist: number; tangentialPressure: number;
    isDrawing: boolean; activePtrId: number | null;
    note: string;
  }>>([]);
  const [diagSnapshot, setDiagSnapshot] = useState<typeof diagEventsRef.current>([]);
  const diagRefreshRef = useRef<number>(0);

  // ── Window-level native pointer listener for diagnostics ────────────────
  // Catches ALL pointer events at the window level (bypasses React synthetic
  // events and element-level capture). This tells us if pointerdown is fired
  // by the OS at all, even if it never reaches the canvas overlay.
  useEffect(() => {
    if (!diagVisible) return;
    const now = () => Date.now();
    const cutoff = () => now() - 30000;
    const record = (type: string, e: PointerEvent) => {
      if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
      diagEventsRef.current = diagEventsRef.current.filter(ev => ev.t > cutoff());
      const note = type === 'down' && e.buttons === 0 ? 'WIN-BTN0' :
                   type === 'down' ? 'WIN-DOWN' :
                   type === 'up'   ? 'WIN-UP'   :
                   type === 'cancel' ? 'WIN-CANCEL' : 'WIN-MOVE';
      diagEventsRef.current.push({
        t: now(), type: `w:${type}`, pointerId: e.pointerId,
        pointerType: e.pointerType,
        pressure: Math.round(e.pressure * 1000) / 1000,
        buttons: e.buttons, isPrimary: e.isPrimary,
        width: 0, height: 0, tiltX: Math.round(e.tiltX), tiltY: Math.round(e.tiltY),
        twist: 0, tangentialPressure: 0,
        isDrawing: isDrawing.current, activePtrId: activePointerId.current,
        note,
      });
      if (diagRefreshRef.current) cancelAnimationFrame(diagRefreshRef.current);
      diagRefreshRef.current = requestAnimationFrame(() => {
        setDiagSnapshot([...diagEventsRef.current].reverse().slice(0, 200));
      });
    };
    const onDown   = (e: PointerEvent) => record('down', e);
    const onUp     = (e: PointerEvent) => record('up', e);
    const onCancel = (e: PointerEvent) => record('cancel', e);
    window.addEventListener('pointerdown',   onDown,   { capture: true, passive: true });
    window.addEventListener('pointerup',     onUp,     { capture: true, passive: true });
    window.addEventListener('pointercancel', onCancel, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown',   onDown,   { capture: true });
      window.removeEventListener('pointerup',     onUp,     { capture: true });
      window.removeEventListener('pointercancel', onCancel, { capture: true });
    };
  }, [diagVisible]);

  const recordDiagEvent = useCallback((e: React.PointerEvent, type: string, note = '') => {
    const now = Date.now();
    // Prune events older than 30s
    const cutoff = now - 30000;
    diagEventsRef.current = diagEventsRef.current.filter(ev => ev.t > cutoff);
    diagEventsRef.current.push({
      t: now, type, pointerId: e.pointerId, pointerType: e.pointerType,
      pressure: Math.round(e.pressure * 1000) / 1000,
      buttons: e.buttons, isPrimary: e.isPrimary,
      width: Math.round(e.width * 10) / 10,
      height: Math.round(e.height * 10) / 10,
      tiltX: Math.round(e.tiltX), tiltY: Math.round(e.tiltY),
      twist: Math.round(e.twist),
      tangentialPressure: Math.round(e.tangentialPressure * 1000) / 1000,
      isDrawing: isDrawing.current,
      activePtrId: activePointerId.current,
      note,
    });
    // Debounce React state update to avoid re-render on every move
    if (diagRefreshRef.current) cancelAnimationFrame(diagRefreshRef.current);
    diagRefreshRef.current = requestAnimationFrame(() => {
      setDiagSnapshot([...diagEventsRef.current].reverse().slice(0, 200));
    });
  }, []);

  const diagWrapDown = useCallback((e: React.PointerEvent) => {
    // Record BEFORE handlePointerDown so we see it even if handlePointerDown returns early
    const note = e.buttons === 0 ? 'BTN0' : '';
    recordDiagEvent(e, 'down', note);
    handlePointerDown(e);
  }, [handlePointerDown, recordDiagEvent]);

  const diagWrapMove = useCallback((e: React.PointerEvent) => {
    // Only record move events for pen/stylus to avoid noise
    if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
      const note = e.buttons === 0 ? 'HOVER' :
        e.pointerId !== (activePointerId.current ?? e.pointerId) ? 'ID_MISMATCH' : '';
      recordDiagEvent(e, 'move', note);
    }
    handlePointerMove(e);
  }, [handlePointerMove, recordDiagEvent]);

  const diagWrapUp = useCallback((e: React.PointerEvent) => {
    const note = (e.pointerType === 'pen' && e.buttons === 0 && e.pressure === 0 && isDrawing.current)
      ? 'GHOST-UP' : '';
    recordDiagEvent(e, 'up', note);
    handlePointerUp(e);
  }, [handlePointerUp, recordDiagEvent]);

  const diagWrapCancel = useCallback((e: React.PointerEvent) => {
    recordDiagEvent(e, 'cancel', 'CANCELLED');
    handlePointerCancel(e);
  }, [handlePointerCancel, recordDiagEvent]);

  const typeColor: Record<string, string> = {
    down: '#4ade80', up: '#60a5fa', cancel: '#f87171', move: '#d1d5db',
  };

  const page = getActivePage();

  if (!page) {
    return (
      <div className="canvas-empty">
        <div className="canvas-empty-icon">📒</div>
        <p>Select or create a notebook to start drawing</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', touchAction: 'none' }}
      />
      <canvas
        ref={overlayRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', touchAction: 'none', cursor: state.activeTool === 'eraser' ? 'none' : 'crosshair' }}
        onPointerDown={diagWrapDown}
        onPointerMove={diagWrapMove}
        onPointerUp={diagWrapUp}
        onPointerCancel={diagWrapCancel}
      />
      {renderRuler()}

      {/* Pen Diagnostics Toggle Button */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={() => setDiagVisible(v => !v)}
        style={{
          position: 'absolute', bottom: 12, right: 12, zIndex: 100,
          background: diagVisible ? '#1d4ed8' : 'rgba(0,0,0,0.6)',
          color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 8, padding: '6px 12px', fontSize: 12,
          cursor: 'pointer', fontFamily: 'monospace',
        }}
      >
        🖊 Diag {diagVisible ? '▲' : '▼'}
      </button>

      {/* Pen Diagnostics Panel */}
      {diagVisible && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 48, right: 8, zIndex: 100,
            width: 420, maxHeight: '65vh',
            background: 'rgba(10,10,15,0.95)', color: '#e5e7eb',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10,
            fontFamily: 'monospace', fontSize: 10.5,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          {/* Header */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold', fontSize: 12 }}>🖊 Pen Diagnostics — last 30s ({diagSnapshot.length} events)</span>
            <button
              onClick={() => { diagEventsRef.current = []; setDiagSnapshot([]); }}
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
            >Clear</button>
          </div>
          {/* Column headers */}
          <div style={{ padding: '4px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af', display: 'grid', gridTemplateColumns: '45px 50px 30px 28px 55px 52px 40px 1fr', gap: 2 }}>
            <span>type</span><span>ptrId</span><span>typ</span><span>btn</span><span>pressure</span><span>tilt x/y</span><span>draw</span><span>note</span>
          </div>
          {/* Event rows */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {diagSnapshot.length === 0 && (
              <div style={{ padding: 16, color: '#6b7280', textAlign: 'center' }}>Draw something to see events...</div>
            )}
            {diagSnapshot.map((ev, i) => (
              <div key={i} style={{
                padding: '2px 12px',
                background: ev.note ? 'rgba(251,191,36,0.12)' : ev.type === 'cancel' ? 'rgba(248,113,113,0.08)' : 'transparent',
                display: 'grid', gridTemplateColumns: '45px 50px 30px 28px 55px 52px 40px 1fr', gap: 2,
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                <span style={{ color: typeColor[ev.type] ?? '#fff', fontWeight: ev.type !== 'move' ? 'bold' : 'normal' }}>{ev.type}</span>
                <span style={{ color: '#a78bfa' }}>#{ev.pointerId}</span>
                <span style={{ color: '#67e8f9' }}>{ev.pointerType.slice(0,3)}</span>
                <span style={{ color: ev.buttons === 0 ? '#f87171' : '#4ade80' }}>{ev.buttons}</span>
                <span style={{ color: ev.pressure === 0 ? '#6b7280' : '#fbbf24' }}>{ev.pressure.toFixed(3)}</span>
                <span style={{ color: '#94a3b8' }}>{ev.tiltX}/{ev.tiltY}</span>
                <span style={{ color: ev.isDrawing ? '#4ade80' : '#6b7280' }}>{ev.isDrawing ? 'Y' : 'N'}</span>
                <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{ev.note}</span>
              </div>
            ))}
          </div>
          {/* Live stats */}
          <div style={{ padding: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: 10 }}>
            activePtr: <span style={{ color: '#a78bfa' }}>{activePointerId.current ?? 'null'}</span>
            {' · '} isDrawing: <span style={{ color: isDrawing.current ? '#4ade80' : '#f87171' }}>{String(isDrawing.current)}</span>
            {' · '} pts: <span style={{ color: '#60a5fa' }}>{currentPoints.current.length}</span>
          </div>
        </div>
      )}
    </div>
  );
};
