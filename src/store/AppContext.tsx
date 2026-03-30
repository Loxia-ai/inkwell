import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import { AppState, Notebook, Stroke, ToolType, ShapeType, StrokeStyle, HistoryEntry, Page, PageBackground, PageImage } from '../types';
import { getAllNotebooks, saveNotebook, createNotebook, createBlankPage, deleteNotebook as dbDeleteNotebook } from './db';
import { v4 as uuid } from 'uuid';

// ─── Actions ────────────────────────────────────────────────────

type Action =
  | { type: 'SET_NOTEBOOKS'; notebooks: Notebook[] }
  | { type: 'SET_ACTIVE_NOTEBOOK'; id: string | null }
  | { type: 'SET_ACTIVE_PAGE'; index: number }
  | { type: 'SET_TOOL'; tool: ToolType }
  | { type: 'SET_SHAPE'; shape: ShapeType }
  | { type: 'SET_STROKE_STYLE'; style: Partial<StrokeStyle> }
  | { type: 'ADD_STROKE'; pageId: string; stroke: Stroke }
  | { type: 'REMOVE_STROKES'; pageId: string; strokeIds: string[] }
  | { type: 'CLEAR_PAGE'; pageId: string }
  | { type: 'ADD_PAGE'; afterIndex: number }
  | { type: 'DELETE_PAGE'; index: number }
  | { type: 'SET_PAGE_BACKGROUND'; pageId: string; bg: PageBackground }
  | { type: 'UPDATE_NOTEBOOK_TITLE'; id: string; title: string }
  | { type: 'ADD_NOTEBOOK'; notebook: Notebook }
  | { type: 'DELETE_NOTEBOOK'; id: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'PUSH_HISTORY'; entry: HistoryEntry }
  | { type: 'SET_PALM_REJECTION'; enabled: boolean }
  | { type: 'SET_RULER_VISIBLE'; visible: boolean }
  | { type: 'SET_RULER_ANGLE'; angle: number }
  | { type: 'SET_RULER_POSITION'; x: number; y: number }
  | { type: 'ADD_IMAGE'; pageId: string; image: PageImage }
  | { type: 'REMOVE_IMAGE'; pageId: string; imageId: string }
  | { type: 'UPDATE_IMAGE'; pageId: string; imageId: string; updates: Partial<PageImage> };

const initialStrokeStyle: StrokeStyle = {
  color: '#000000',
  width: 2.5,
  opacity: 1,
  tool: 'pen',
};

const initialState: AppState = {
  notebooks: [],
  activeNotebookId: null,
  activePageIndex: 0,
  activeTool: 'pen',
  activeShape: 'rectangle',
  strokeStyle: initialStrokeStyle,
  canvasTransform: { offsetX: 0, offsetY: 0, scale: 1 },
  ruler: { visible: false, x: 200, y: 400, angle: 0, length: 600 },
  undoStack: [],
  redoStack: [],
  palmRejection: true,
};

function getActivePage(state: AppState): Page | null {
  const nb = state.notebooks.find(n => n.id === state.activeNotebookId);
  if (!nb) return null;
  return nb.pages[state.activePageIndex] || null;
}

function updatePageInState(state: AppState, pageId: string, updater: (page: Page) => Page): AppState {
  return {
    ...state,
    notebooks: state.notebooks.map(nb => ({
      ...nb,
      pages: nb.pages.map(p => p.id === pageId ? updater(p) : p),
    })),
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_NOTEBOOKS':
      return { ...state, notebooks: action.notebooks };

    case 'SET_ACTIVE_NOTEBOOK':
      return { ...state, activeNotebookId: action.id, activePageIndex: 0, undoStack: [], redoStack: [] };

    case 'SET_ACTIVE_PAGE':
      return { ...state, activePageIndex: action.index };

    case 'SET_TOOL': {
      const newStyle = { ...state.strokeStyle, tool: action.tool };
      return { ...state, activeTool: action.tool, strokeStyle: newStyle };
    }

    case 'SET_SHAPE':
      return { ...state, activeShape: action.shape };

    case 'SET_STROKE_STYLE':
      return { ...state, strokeStyle: { ...state.strokeStyle, ...action.style } };

    case 'ADD_STROKE':
      return updatePageInState(state, action.pageId, page => ({
        ...page,
        strokes: [...page.strokes, action.stroke],
        updatedAt: Date.now(),
      }));

    case 'REMOVE_STROKES':
      return updatePageInState(state, action.pageId, page => ({
        ...page,
        strokes: page.strokes.filter(s => !action.strokeIds.includes(s.id)),
        updatedAt: Date.now(),
      }));

    case 'CLEAR_PAGE':
      return updatePageInState(state, action.pageId, page => ({
        ...page,
        strokes: [],
        updatedAt: Date.now(),
      }));

    case 'ADD_PAGE': {
      const nb = state.notebooks.find(n => n.id === state.activeNotebookId);
      if (!nb) return state;
      const refPage = nb.pages[0];
      const newPage = createBlankPage(
        refPage?.width,
        refPage?.height,
        refPage?.background
      );
      const newPages = [...nb.pages];
      newPages.splice(action.afterIndex + 1, 0, newPage);
      return {
        ...state,
        notebooks: state.notebooks.map(n =>
          n.id === nb.id ? { ...n, pages: newPages, updatedAt: Date.now() } : n
        ),
        activePageIndex: action.afterIndex + 1,
      };
    }

    case 'DELETE_PAGE': {
      const nb2 = state.notebooks.find(n => n.id === state.activeNotebookId);
      if (!nb2 || nb2.pages.length <= 1) return state;
      const newPages2 = nb2.pages.filter((_, i) => i !== action.index);
      return {
        ...state,
        notebooks: state.notebooks.map(n =>
          n.id === nb2.id ? { ...n, pages: newPages2, updatedAt: Date.now() } : n
        ),
        activePageIndex: Math.min(state.activePageIndex, newPages2.length - 1),
      };
    }

    case 'SET_PAGE_BACKGROUND':
      return updatePageInState(state, action.pageId, page => ({
        ...page,
        background: action.bg,
      }));

    case 'UPDATE_NOTEBOOK_TITLE':
      return {
        ...state,
        notebooks: state.notebooks.map(n =>
          n.id === action.id ? { ...n, title: action.title, updatedAt: Date.now() } : n
        ),
      };

    case 'ADD_NOTEBOOK':
      return { ...state, notebooks: [action.notebook, ...state.notebooks] };

    case 'DELETE_NOTEBOOK':
      return {
        ...state,
        notebooks: state.notebooks.filter(n => n.id !== action.id),
        activeNotebookId: state.activeNotebookId === action.id ? null : state.activeNotebookId,
      };

    case 'PUSH_HISTORY':
      return {
        ...state,
        undoStack: [...state.undoStack.slice(-50), action.entry],
        redoStack: [],
      };

    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const entry = state.undoStack[state.undoStack.length - 1];
      let newState = { ...state, undoStack: state.undoStack.slice(0, -1) };

      if (entry.type === 'add') {
        const ids = entry.strokes.map(s => s.id);
        newState = updatePageInState(newState, entry.pageId, page => ({
          ...page,
          strokes: page.strokes.filter(s => !ids.includes(s.id)),
        }));
      } else if (entry.type === 'remove') {
        newState = updatePageInState(newState, entry.pageId, page => ({
          ...page,
          strokes: [...page.strokes, ...entry.strokes],
        }));
      }

      return { ...newState, redoStack: [...state.redoStack, entry] };
    }

    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const entry = state.redoStack[state.redoStack.length - 1];
      let newState = { ...state, redoStack: state.redoStack.slice(0, -1) };

      if (entry.type === 'add') {
        newState = updatePageInState(newState, entry.pageId, page => ({
          ...page,
          strokes: [...page.strokes, ...entry.strokes],
        }));
      } else if (entry.type === 'remove') {
        const ids = entry.strokes.map(s => s.id);
        newState = updatePageInState(newState, entry.pageId, page => ({
          ...page,
          strokes: page.strokes.filter(s => !ids.includes(s.id)),
        }));
      }

      return { ...newState, undoStack: [...state.undoStack, entry] };
    }

    case 'SET_PALM_REJECTION':
      return { ...state, palmRejection: action.enabled };

    case 'SET_RULER_VISIBLE':
      return { ...state, ruler: { ...state.ruler, visible: action.visible } };

    case 'SET_RULER_ANGLE':
      return { ...state, ruler: { ...state.ruler, angle: action.angle } };

    case 'SET_RULER_POSITION':
      return { ...state, ruler: { ...state.ruler, x: action.x, y: action.y } };

    case 'ADD_IMAGE':
      return updatePageInState(state, action.pageId, page => ({
        ...page,
        images: [...page.images, action.image],
        updatedAt: Date.now(),
      }));

    case 'REMOVE_IMAGE':
      return updatePageInState(state, action.pageId, page => ({
        ...page,
        images: page.images.filter(img => img.id !== action.imageId),
        updatedAt: Date.now(),
      }));

    case 'UPDATE_IMAGE':
      return updatePageInState(state, action.pageId, page => ({
        ...page,
        images: page.images.map(img =>
          img.id === action.imageId ? { ...img, ...action.updates } : img
        ),
        updatedAt: Date.now(),
      }));

    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  getActivePage: () => Page | null;
  getActiveNotebook: () => Notebook | null;
  persistNotebook: (notebook: Notebook) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load notebooks on mount
  useEffect(() => {
    getAllNotebooks().then(notebooks => {
      dispatch({ type: 'SET_NOTEBOOKS', notebooks });
    });
  }, []);

  const getActivePageCb = useCallback((): Page | null => {
    return getActivePage(state);
  }, [state]);

  const getActiveNotebookCb = useCallback((): Notebook | null => {
    return state.notebooks.find(n => n.id === state.activeNotebookId) || null;
  }, [state.notebooks, state.activeNotebookId]);

  const persistNotebook = useCallback((notebook: Notebook) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveNotebook(notebook);
    }, 300);
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch, getActivePage: getActivePageCb, getActiveNotebook: getActiveNotebookCb, persistNotebook }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
