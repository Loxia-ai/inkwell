import React, { useRef, useEffect, useCallback } from 'react';
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
const GRAPH_SPACING = 20; // 5mm-style small grid
const MUSIC_STAFF_SPACING = 8; // line spacing within a staff
const MUSIC_STAFF_GAP = 64; // gap between staff groups

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

  // Pinch/pan state
  const touchCache = useRef<Map<number, PointerEvent>>(new Map());
  const lastPinchDist = useRef<number | null>(null);
  const lastPanPos = useRef<{ x: number; y: number } | null>(null);
  const transformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });

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
      // Engineering graph paper: small grid with major lines every 5
      const spacing = GRAPH_SPACING * t.scale;
      const startX = (t.offsetX % spacing);
      const startY = (t.offsetY % spacing);
      const majorEvery = 5;

      // Minor grid lines
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

      // Major grid lines
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
      // Cornell Notes: left margin (30%), bottom summary area (25%), horizontal lines
      const marginX = width * 0.30;
      const summaryY = height * 0.75;

      // Ruled lines in the main area
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

      // Left margin line (Cue column)
      ctx.strokeStyle = '#E85D5D';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(marginX, 0);
      ctx.lineTo(marginX, height);
      ctx.stroke();

      // Bottom summary separator
      ctx.strokeStyle = '#E85D5D';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, summaryY);
      ctx.lineTo(width, summaryY);
      ctx.stroke();

      // Labels (subtle)
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.font = `${11 * t.scale}px -apple-system, sans-serif`;
      ctx.fillText('Cues', 8, 16);
      ctx.fillText('Notes', marginX + 8, 16);
      ctx.fillText('Summary', 8, summaryY + 16);
    } else if (bg === 'isometric') {
      // Isometric grid: equilateral triangle pattern
      const spacing = 28 * t.scale;
      const h = spacing * Math.sqrt(3) / 2;
      ctx.strokeStyle = '#DDDDD8';
      ctx.lineWidth = 0.4;

      const startX = (t.offsetX % spacing) - spacing;
      const startY = (t.offsetY % (h * 2)) - h * 2;

      // Horizontal lines
      for (let y = startY; y < height + h; y += h) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Diagonal lines (/ direction)
      for (let x = startX - height; x < width + height; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, height + h);
        ctx.lineTo(x + height / Math.tan(Math.PI / 3), -h);
        ctx.stroke();
      }

      // Diagonal lines (\ direction)
      for (let x = startX - height; x < width + height; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, -h);
        ctx.lineTo(x + height / Math.tan(Math.PI / 3), height + h);
        ctx.stroke();
      }
    } else if (bg === 'music') {
      // Music staff paper: groups of 5 lines with gaps
      ctx.strokeStyle = '#B8B8B5';
      ctx.lineWidth = 0.6;
      const lineH = MUSIC_STAFF_SPACING * t.scale;
      const gapH = MUSIC_STAFF_GAP * t.scale;
      const staffHeight = lineH * 4; // 5 lines = 4 gaps
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

  const drawImages = useCallback((ctx: CanvasRenderingContext2D, images: PageImage[]) => {
    for (const img of images) {
      const htmlImg = getOrLoadImage(img.src);
      if (!htmlImg) {
        // Image still loading, trigger redraw when ready
        const pending = imageCache.get(img.src);
        if (pending && !pending.complete) {
          pending.onload = () => redrawAll();
        }
        continue;
      }
      ctx.save();
      ctx.globalAlpha = img.opacity;
      if (img.rotation !== 0) {
        const cx = img.x + img.width / 2;
        const cy = img.y + img.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((img.rotation * Math.PI) / 180);
        ctx.drawImage(htmlImg, -img.width / 2, -img.height / 2, img.width, img.height);
      } else {
        ctx.drawImage(htmlImg, img.x, img.y, img.width, img.height);
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

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    drawBackground(ctx, rect.width, rect.height, page.background);

    const t = transformRef.current;
    ctx.save();
    ctx.translate(t.offsetX, t.offsetY);
    ctx.scale(t.scale, t.scale);

    // Draw images below strokes
    drawImages(ctx, page.images);

    for (const stroke of page.strokes) {
      StrokeRenderer.renderStroke(ctx, stroke);
    }

    ctx.restore();
  }, [getActivePage, drawBackground, drawImages]);

  // ─── Resize handling ───────────────────────────────────────

  useEffect(() => {
    const handleResize = () => {
      redrawAll();
    };
    window.addEventListener('resize', handleResize);

    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
    };
  }, [redrawAll]);

  // Redraw when page/strokes change
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

  // ─── Pixel eraser: split strokes at eraser contact points ──

  const performPixelErase = useCallback((eraserPoint: Point) => {
    const page = getActivePage();
    if (!page) return;
    const eraserRadius = state.strokeStyle.width * 2;
    const r2 = eraserRadius * eraserRadius;

    for (const stroke of page.strokes) {
      if (pixelErasedIds.current.has(stroke.id)) continue;
      if (stroke.shapeData) {
        // For shapes, just remove the whole shape if hit
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

      // Find which point indices are hit by the eraser
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

      // If all points hit, just remove the whole stroke
      if (hitIndices.size >= stroke.points.length) {
        pixelErasedIds.current.add(stroke.id);
        pixelErasedStrokes.current.push(stroke);
        continue;
      }

      // Split the stroke into segments that survive the eraser
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

      // Create new strokes from surviving segments
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

    // Apply immediately for visual feedback
    if (pixelErasedStrokes.current.length > 0) {
      redrawAll();
    }
  }, [getActivePage, state.strokeStyle.width, redrawAll]);

  // ─── Finish current stroke (used by rapid-tap recovery) ────

  const finishStroke = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const prevPointerId = activePointerId.current;
    activePointerId.current = null;
    predictedPoint.current = null;

    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    needsLiveRender.current = false;

    const page = getActivePage();
    if (!page) return;

    const points = currentPoints.current;
    if (points.length === 0) return;

    // Clear overlay
    const overlay = overlayRef.current;
    if (overlay) {
      const octx = overlay.getContext('2d');
      if (octx) {
        const rect = overlay.getBoundingClientRect();
        octx.clearRect(0, 0, rect.width, rect.height);
      }
    }

    if (state.activeTool === 'eraser') {
      commitEraser(page, points);
      return;
    }

    // Build stroke
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

    dispatch({ type: 'PUSH_HISTORY', entry: { type: 'add', pageId: page.id, strokes: [stroke] } });
    dispatch({ type: 'ADD_STROKE', pageId: page.id, stroke });

    const nb = getActiveNotebook();
    if (nb) persistNotebook(nb);
  }, [state.activeTool, state.activeShape, state.strokeStyle, getActivePage, getActiveNotebook, dispatch, persistNotebook]);

  // ─── Commit eraser action based on mode ─────────────────────

  const commitEraser = useCallback((page: NonNullable<ReturnType<typeof getActivePage>>, points: Point[]) => {
    const mode = state.eraserMode;

    if (mode === 'pixel') {
      // Pixel eraser: remove erased strokes, add split fragments
      const erasedIds = Array.from(pixelErasedIds.current);
      if (erasedIds.length > 0) {
        dispatch({ type: 'PUSH_HISTORY', entry: { type: 'remove', pageId: page.id, strokes: [...pixelErasedStrokes.current] } });
        dispatch({ type: 'REMOVE_STROKES', pageId: page.id, strokeIds: erasedIds });
        // Add the surviving fragments
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
      // Selection eraser: delete strokes inside the lasso polygon
      if (points.length < 3) return; // need at least a triangle

      // Point-in-polygon test (ray casting algorithm)
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
        // Check if the stroke's center or any of its points are inside the lasso
        let inside = false;
        if (stroke.shapeData) {
          // For shapes, check center of bounds
          const cx = (stroke.bounds.minX + stroke.bounds.maxX) / 2;
          const cy = (stroke.bounds.minY + stroke.bounds.maxY) / 2;
          inside = isInsideLasso(cx, cy);
        } else {
          // For freehand strokes, check if majority of points are inside
          let insideCount = 0;
          const checkEvery = Math.max(1, Math.floor(stroke.points.length / 10));
          for (let i = 0; i < stroke.points.length; i += checkEvery) {
            if (isInsideLasso(stroke.points[i].x, stroke.points[i].y)) {
              insideCount++;
            }
          }
          const totalChecked = Math.ceil(stroke.points.length / checkEvery);
          inside = insideCount > totalChecked * 0.3; // 30% threshold
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

    // Default: stroke eraser (remove whole strokes on contact)
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
          ) {
            hit = true;
            break;
          }
        } else {
          for (const sp of stroke.points) {
            const dx = ep.x - sp.x;
            const dy = ep.y - sp.y;
            if (dx * dx + dy * dy < eraserRadius * eraserRadius) {
              hit = true;
              break;
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

  // ─── Pointer handlers ─────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Palm rejection: only accept pen input when enabled
    if (state.palmRejection && e.pointerType === 'touch' && state.activeTool !== 'lasso') {
      touchCache.current.set(e.pointerId, e.nativeEvent);
      if (touchCache.current.size === 2) {
        const pts = Array.from(touchCache.current.values());
        lastPinchDist.current = Math.hypot(
          pts[1].clientX - pts[0].clientX,
          pts[1].clientY - pts[0].clientY
        );
        lastPanPos.current = {
          x: (pts[0].clientX + pts[1].clientX) / 2,
          y: (pts[0].clientY + pts[1].clientY) / 2,
        };
      }
      return;
    }

    // If we're already drawing with a DIFFERENT pointer, ignore.
    // But if the SAME pointer re-enters (rapid tap), force-finish the previous stroke.
    if (isDrawing.current) {
      if (activePointerId.current !== null && activePointerId.current !== e.pointerId) {
        return; // different pointer, ignore
      }
      // Same pointer or null — force-finish previous stroke so we don't drop this one
      finishStroke();
    }

    isDrawing.current = true;
    activePointerId.current = e.pointerId;
    currentPoints.current = [];
    lastRenderIndex.current = 0;
    pixelErasedIds.current.clear();
    pixelErasedStrokes.current = [];
    pixelNewStrokes.current = [];

    const pos = screenToCanvas(e.clientX, e.clientY);
    const point: Point = {
      x: pos.x,
      y: pos.y,
      pressure: e.pressure || 0.5,
      timestamp: Date.now(),
    };
    currentPoints.current.push(point);
    lastPointTime.current = point.timestamp;
    predictedPoint.current = null;

    // Clear overlay
    const overlay = overlayRef.current;
    if (overlay) {
      const octx = overlay.getContext('2d');
      if (octx) {
        const dpr = window.devicePixelRatio || 2;
        const rect = overlay.getBoundingClientRect();
        overlay.width = rect.width * dpr;
        overlay.height = rect.height * dpr;
        octx.scale(dpr, dpr);
      }
    }

    // Perform real-time pixel erasing on move (for immediate feedback)
    if (state.activeTool === 'eraser' && state.eraserMode === 'pixel') {
      performPixelErase(point);
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [state.palmRejection, state.activeTool, state.eraserMode, screenToCanvas, finishStroke, performPixelErase]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Handle pinch/pan for touch
    if (state.palmRejection && e.pointerType === 'touch') {
      touchCache.current.set(e.pointerId, e.nativeEvent);
      if (touchCache.current.size === 2 && lastPinchDist.current !== null) {
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

        if (lastPanPos.current) {
          const panDx = center.x - lastPanPos.current.x;
          const panDy = center.y - lastPanPos.current.y;
          transformRef.current = {
            offsetX: t.offsetX + panDx,
            offsetY: t.offsetY + panDy,
            scale: newScale,
          };
        }

        lastPinchDist.current = dist;
        lastPanPos.current = center;
        redrawAll();
      }
      return;
    }

    if (!isDrawing.current || e.pointerId !== activePointerId.current) return;

    // ─── Collect ALL coalesced events for complete capture ──────
    // This is critical for fast writing — browsers batch multiple
    // hardware events between frames, and getCoalescedEvents gives
    // us every single one so no strokes are skipped.
    const coalesced = (e.nativeEvent as any).getCoalescedEvents?.() || [];
    const predicted = (e.nativeEvent as any).getPredictedEvents?.() || [];
    const now = Date.now();

    if (coalesced.length > 0) {
      for (const ce of coalesced) {
        const cp = screenToCanvas(ce.clientX, ce.clientY);
        const newPt: Point = {
          x: cp.x,
          y: cp.y,
          pressure: ce.pressure || 0.5,
          timestamp: ce.timeStamp ? Math.round(ce.timeStamp) : now,
        };
        // Skip duplicate points (distance threshold)
        const pts = currentPoints.current;
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          const dx = newPt.x - last.x;
          const dy = newPt.y - last.y;
          if (dx * dx + dy * dy < 0.25) continue; // < 0.5px — skip
        }
        currentPoints.current.push(newPt);
      }
    } else {
      const pos = screenToCanvas(e.clientX, e.clientY);
      const newPt: Point = {
        x: pos.x,
        y: pos.y,
        pressure: e.pressure || 0.5,
        timestamp: now,
      };
      const pts = currentPoints.current;
      if (pts.length > 0) {
        const last = pts[pts.length - 1];
        const dx = newPt.x - last.x;
        const dy = newPt.y - last.y;
        if (dx * dx + dy * dy >= 0.25) {
          currentPoints.current.push(newPt);
        }
      } else {
        currentPoints.current.push(newPt);
      }
    }

    // Store predicted point for smoother live rendering
    if (predicted.length > 0) {
      const pe = predicted[0];
      const pp = screenToCanvas(pe.clientX, pe.clientY);
      predictedPoint.current = {
        x: pp.x,
        y: pp.y,
        pressure: pe.pressure || 0.5,
        timestamp: now,
      };
    } else {
      predictedPoint.current = null;
    }

    lastPointTime.current = now;

    // ─── Pixel eraser: erase in real-time during drag ───────────
    if (state.activeTool === 'eraser' && state.eraserMode === 'pixel') {
      const lastPt = currentPoints.current[currentPoints.current.length - 1];
      if (lastPt) performPixelErase(lastPt);
    }

    // ─── Schedule live render via rAF (batched for 60fps) ──────
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
        const rect = overlay.getBoundingClientRect();

        if (state.activeTool === 'shape') {
          octx.clearRect(0, 0, rect.width, rect.height);
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
          octx.clearRect(0, 0, rect.width, rect.height);
          // Selection eraser: draw lasso path
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
          // Full redraw of live stroke on overlay for smoothness
          octx.clearRect(0, 0, rect.width, rect.height);
          octx.save();
          const t = transformRef.current;
          octx.translate(t.offsetX, t.offsetY);
          octx.scale(t.scale, t.scale);

          // Include predicted point for reduced latency
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
  }, [state.palmRejection, state.activeTool, state.eraserMode, state.activeShape, state.strokeStyle, screenToCanvas, redrawAll, performPixelErase]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // Clean up touch cache
    touchCache.current.delete(e.pointerId);
    if (touchCache.current.size < 2) {
      lastPinchDist.current = null;
      lastPanPos.current = null;
    }

    if (!isDrawing.current || e.pointerId !== activePointerId.current) return;

    // Delegate to finishStroke which handles all tool types
    finishStroke();
  }, [finishStroke]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    touchCache.current.delete(e.pointerId);
    if (e.pointerId === activePointerId.current) {
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
  }, []);

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
              const dx = me.clientX - rulerX;
              const dy = me.clientY - rulerY;
              let ang = Math.atan2(dy, dx) * (180 / Math.PI);
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
      {renderRuler()}
    </div>
  );
};
