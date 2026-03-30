// ─── Core Drawing Types ─────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
}

export type ToolType =
  | 'pen'
  | 'pencil'
  | 'highlighter'
  | 'eraser'
  | 'lasso'
  | 'shape'
  | 'ruler'
  | 'calligraphy'
  | 'fountain'
  | 'marker'
  | 'spray';

/** Eraser sub-modes */
export type EraserMode = 'stroke' | 'pixel' | 'selection' | 'clear';

export type ShapeType = 'line' | 'circle' | 'rectangle' | 'arrow';

export interface StrokeStyle {
  color: string;
  width: number;
  opacity: number;
  tool: ToolType;
  shape?: ShapeType;
}

export interface Stroke {
  id: string;
  points: Point[];
  style: StrokeStyle;
  bounds: Bounds;
  /** For shape strokes, the finalized geometry */
  shapeData?: ShapeData;
}

export interface ShapeData {
  type: ShapeType;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** For circles: center + radius */
  cx?: number;
  cy?: number;
  radius?: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ─── Page & Notebook ────────────────────────────────────────────

export type PageBackground =
  | 'blank'
  | 'lined'
  | 'grid'
  | 'dotted'
  | 'graph'
  | 'cornell'
  | 'isometric'
  | 'music';

/** Image inserted onto a page */
export interface PageImage {
  id: string;
  /** Base64 data URL */
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export interface Page {
  id: string;
  strokes: Stroke[];
  images: PageImage[];
  background: PageBackground;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Notebook Templates ─────────────────────────────────────────

export type NotebookSize = 'a4' | 'a5' | 'letter' | 'square' | 'custom';

export interface NotebookTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  size: NotebookSize;
  width: number;
  height: number;
  background: PageBackground;
  coverColor: string;
  coverImage?: string;
}

export interface Notebook {
  id: string;
  title: string;
  coverColor: string;
  coverImage?: string;
  pages: Page[];
  templateId?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Canvas State ───────────────────────────────────────────────

export interface CanvasTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface RulerState {
  visible: boolean;
  x: number;
  y: number;
  angle: number; // degrees
  length: number;
}

export interface AppState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  activePageIndex: number;
  activeTool: ToolType;
  activeShape: ShapeType;
  eraserMode: EraserMode;
  strokeStyle: StrokeStyle;
  canvasTransform: CanvasTransform;
  ruler: RulerState;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  palmRejection: boolean;
  /** Active lasso selection points (canvas coords) */
  selectionPath: Point[];
  /** Stroke IDs currently selected by lasso */
  selectedStrokeIds: string[];
}

export interface HistoryEntry {
  type: 'add' | 'remove' | 'clear';
  pageId: string;
  strokes: Stroke[];
}

// ─── Serialization ──────────────────────────────────────────────

export interface NotebookFile {
  version: number;
  notebook: Notebook;
}
