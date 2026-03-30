import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Notebook, Page, PageBackground, NotebookTemplate } from '../types';
import { v4 as uuid } from 'uuid';

interface InkwellDB extends DBSchema {
  notebooks: {
    key: string;
    value: Notebook;
    indexes: { 'by-updated': number };
  };
}

const DB_NAME = 'inkwell-notebooks';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<InkwellDB> | null = null;

async function getDB(): Promise<IDBPDatabase<InkwellDB>> {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB<InkwellDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore('notebooks', { keyPath: 'id' });
      store.createIndex('by-updated', 'updatedAt');
    },
  });
  return dbInstance;
}

export function createBlankPage(
  width = 1024,
  height = 1366,
  background: PageBackground = 'blank'
): Page {
  return {
    id: uuid(),
    strokes: [],
    images: [],
    background,
    width,
    height,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createNotebook(title: string = 'Untitled Notebook'): Notebook {
  const coverColors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#5856D6', '#FF2D55'];
  return {
    id: uuid(),
    title,
    coverColor: coverColors[Math.floor(Math.random() * coverColors.length)],
    pages: [createBlankPage()],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createNotebookFromTemplate(template: NotebookTemplate, title?: string, coverImage?: string): Notebook {
  return {
    id: uuid(),
    title: title || template.name,
    coverColor: template.coverColor,
    coverImage: coverImage || template.coverImage,
    pages: [createBlankPage(template.width, template.height, template.background)],
    templateId: template.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── Predefined Templates ────────────────────────────────────────

export const NOTEBOOK_TEMPLATES: NotebookTemplate[] = [
  {
    id: 'blank-a4',
    name: 'Blank Notebook',
    description: 'A clean blank canvas',
    icon: '📓',
    size: 'a4',
    width: 1024,
    height: 1366,
    background: 'blank',
    coverColor: '#007AFF',
  },
  {
    id: 'lined-a4',
    name: 'Lined Paper',
    description: 'Classic ruled lines for writing',
    icon: '📝',
    size: 'a4',
    width: 1024,
    height: 1366,
    background: 'lined',
    coverColor: '#34C759',
  },
  {
    id: 'grid-a4',
    name: 'Grid Paper',
    description: 'Square grid for math & diagrams',
    icon: '📐',
    size: 'a4',
    width: 1024,
    height: 1366,
    background: 'grid',
    coverColor: '#5856D6',
  },
  {
    id: 'dotted-a4',
    name: 'Dot Grid',
    description: 'Subtle dots for bullet journaling',
    icon: '⠿',
    size: 'a4',
    width: 1024,
    height: 1366,
    background: 'dotted',
    coverColor: '#FF9500',
  },
  {
    id: 'graph-a4',
    name: 'Graph Paper',
    description: '5mm engineering graph paper',
    icon: '📊',
    size: 'a4',
    width: 1024,
    height: 1366,
    background: 'graph',
    coverColor: '#5AC8FA',
  },
  {
    id: 'cornell-a4',
    name: 'Cornell Notes',
    description: 'Structured note-taking layout',
    icon: '🎓',
    size: 'a4',
    width: 1024,
    height: 1366,
    background: 'cornell',
    coverColor: '#FF3B30',
  },
  {
    id: 'isometric-a4',
    name: 'Isometric Grid',
    description: '3D sketching & technical drawing',
    icon: '🔷',
    size: 'a4',
    width: 1024,
    height: 1366,
    background: 'isometric',
    coverColor: '#AF52DE',
  },
  {
    id: 'music-a4',
    name: 'Music Staff',
    description: 'Staff lines for music notation',
    icon: '🎵',
    size: 'a4',
    width: 1024,
    height: 1366,
    background: 'music',
    coverColor: '#FF2D55',
  },
  {
    id: 'blank-a5',
    name: 'Small Notebook',
    description: 'Compact A5 size',
    icon: '📕',
    size: 'a5',
    width: 768,
    height: 1024,
    background: 'blank',
    coverColor: '#FF9500',
  },
  {
    id: 'blank-letter',
    name: 'Letter Size',
    description: 'US Letter format',
    icon: '📄',
    size: 'letter',
    width: 1056,
    height: 1368,
    background: 'blank',
    coverColor: '#34C759',
  },
  {
    id: 'blank-square',
    name: 'Square Sketchbook',
    description: 'Perfect for sketching',
    icon: '🎨',
    size: 'square',
    width: 1024,
    height: 1024,
    background: 'blank',
    coverColor: '#5856D6',
  },
];

// ─── Database Operations ─────────────────────────────────────────

export async function getAllNotebooks(): Promise<Notebook[]> {
  const db = await getDB();
  const all = await db.getAll('notebooks');
  // Migrate old notebooks that don't have images array
  return all
    .map(nb => ({
      ...nb,
      pages: nb.pages.map(p => ({ ...p, images: p.images || [] })),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNotebook(id: string): Promise<Notebook | undefined> {
  const db = await getDB();
  return db.get('notebooks', id);
}

export async function saveNotebook(notebook: Notebook): Promise<void> {
  const db = await getDB();
  notebook.updatedAt = Date.now();
  await db.put('notebooks', notebook);
}

export async function deleteNotebook(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('notebooks', id);
}

export async function exportNotebook(notebook: Notebook): Promise<Blob> {
  const data: { version: number; notebook: Notebook } = {
    version: 2,
    notebook,
  };
  const json = JSON.stringify(data);
  return new Blob([json], { type: 'application/json' });
}

export async function importNotebook(file: File): Promise<Notebook> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.version || !data.notebook) {
    throw new Error('Invalid notebook file');
  }
  const notebook: Notebook = data.notebook;
  // Assign new ID to avoid conflicts
  notebook.id = uuid();
  notebook.createdAt = Date.now();
  notebook.updatedAt = Date.now();
  // Migrate pages if needed
  notebook.pages = notebook.pages.map(p => ({ ...p, images: p.images || [] }));
  await saveNotebook(notebook);
  return notebook;
}
