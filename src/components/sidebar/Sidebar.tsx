import React, { useState, useRef } from 'react';
import { useApp } from '../../store/AppContext';
import { saveNotebook, deleteNotebook as dbDeleteNotebook, exportNotebook, importNotebook } from '../../store/db';
import type { Notebook } from '../../types';
import './Sidebar.css';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewNotebook: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onNewNotebook }) => {
  const { state, dispatch, persistNotebook } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleNewNotebook = () => {
    onClose();
    // Small delay to let sidebar close animation start
    setTimeout(() => onNewNotebook(), 100);
  };

  const handleSelectNotebook = (id: string) => {
    dispatch({ type: 'SET_ACTIVE_NOTEBOOK', id });
    onClose();
  };

  const handleDeleteNotebook = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await dbDeleteNotebook(id);
    dispatch({ type: 'DELETE_NOTEBOOK', id });
  };

  const handleRename = (nb: Notebook) => {
    setEditingId(nb.id);
    setEditTitle(nb.title);
  };

  const handleRenameSubmit = (id: string) => {
    dispatch({ type: 'UPDATE_NOTEBOOK_TITLE', id, title: editTitle });
    const nb = state.notebooks.find(n => n.id === id);
    if (nb) persistNotebook({ ...nb, title: editTitle });
    setEditingId(null);
  };

  const handleExport = async (nb: Notebook, e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = await exportNotebook(nb);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nb.title.replace(/[^a-z0-9]/gi, '_')}.inkwell`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const nb = await importNotebook(file);
      dispatch({ type: 'ADD_NOTEBOOK', notebook: nb });
      dispatch({ type: 'SET_ACTIVE_NOTEBOOK', id: nb.id });
      onClose();
    } catch (err) {
      console.error('Import failed:', err);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <>
      {isOpen && <div className="sidebar-backdrop" onClick={onClose} />}
      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Notebooks</h2>
          <button className="sidebar-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="sidebar-action-btn primary" onClick={handleNewNotebook}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Notebook
          </button>
          <button className="sidebar-action-btn" onClick={() => fileInputRef.current?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".inkwell,.json"
            onChange={handleImport}
            style={{ display: 'none' }}
          />
        </div>

        <div className="sidebar-list">
          {state.notebooks.length === 0 ? (
            <div className="sidebar-empty">
              <p>No notebooks yet</p>
              <p className="sidebar-empty-hint">Tap + to create your first notebook</p>
            </div>
          ) : (
            state.notebooks.map(nb => (
              <div
                key={nb.id}
                className={`notebook-card ${state.activeNotebookId === nb.id ? 'active' : ''}`}
                onClick={() => handleSelectNotebook(nb.id)}
              >
                <div className="notebook-cover" style={{ backgroundColor: nb.coverColor }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white" opacity="0.8">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="none" stroke="white" strokeWidth="1.5" />
                  </svg>
                </div>
                <div className="notebook-info">
                  {editingId === nb.id ? (
                    <input
                      className="notebook-title-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleRenameSubmit(nb.id)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(nb.id)}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <h3
                      className="notebook-title"
                      onDoubleClick={(e) => { e.stopPropagation(); handleRename(nb); }}
                    >
                      {nb.title}
                    </h3>
                  )}
                  <span className="notebook-meta">
                    {nb.pages.length} {nb.pages.length === 1 ? 'page' : 'pages'} · {formatDate(nb.updatedAt)}
                  </span>
                </div>
                <div className="notebook-actions">
                  <button
                    className="nb-action-btn"
                    onClick={(e) => handleExport(nb, e)}
                    title="Export"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </button>
                  <button
                    className="nb-action-btn danger"
                    onClick={(e) => handleDeleteNotebook(nb.id, e)}
                    title="Delete"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};
