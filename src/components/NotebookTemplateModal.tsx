import React, { useState } from 'react';
import { NotebookTemplate } from '../types';
import { NOTEBOOK_TEMPLATES, createNotebookFromTemplate, saveNotebook } from '../store/db';
import { useApp } from '../store/AppContext';
import './NotebookTemplateModal.css';

const COVER_IMAGES = [
  { id: 'ocean-watercolor', src: '/covers/ocean-watercolor.png', label: 'Ocean' },
  { id: 'sunset-gradient', src: '/covers/sunset-gradient.png', label: 'Sunset' },
  { id: 'botanical', src: '/covers/botanical.png', label: 'Botanical' },
  { id: 'marble-navy', src: '/covers/marble-navy.png', label: 'Marble' },
  { id: 'geometric-purple', src: '/covers/geometric-purple.png', label: 'Geometric' },
  { id: 'zen-mountains', src: '/covers/zen-mountains.png', label: 'Zen' },
  { id: 'paint-splatter', src: '/covers/paint-splatter.png', label: 'Splatter' },
  { id: 'linen-gold', src: '/covers/linen-gold.png', label: 'Linen' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const NotebookTemplateModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { dispatch } = useApp();
  const [title, setTitle] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('blank-a4');
  const [selectedCover, setSelectedCover] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async () => {
    const template = NOTEBOOK_TEMPLATES.find(t => t.id === selectedTemplate);
    if (!template) return;

    const coverSrc = selectedCover
      ? COVER_IMAGES.find(c => c.id === selectedCover)?.src
      : undefined;

    const nb = createNotebookFromTemplate(template, title.trim() || undefined, coverSrc);
    await saveNotebook(nb);
    dispatch({ type: 'ADD_NOTEBOOK', notebook: nb });
    dispatch({ type: 'SET_ACTIVE_NOTEBOOK', id: nb.id });

    setTitle('');
    setSelectedTemplate('blank-a4');
    setSelectedCover(null);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Group templates by size
  const sizeGroups: Record<string, NotebookTemplate[]> = {};
  for (const t of NOTEBOOK_TEMPLATES) {
    const key = t.size === 'a4' ? 'Standard (A4)' : t.size === 'a5' ? 'Compact (A5)' : t.size === 'letter' ? 'Letter' : t.size === 'square' ? 'Square' : 'Other';
    if (!sizeGroups[key]) sizeGroups[key] = [];
    sizeGroups[key].push(t);
  }

  return (
    <div className="template-backdrop" onClick={handleBackdropClick}>
      <div className="template-modal">
        <div className="template-header">
          <div className="template-header-content">
            <h2>New Notebook</h2>
            <p className="template-header-subtitle">Choose a template and cover</p>
          </div>
          <button className="template-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="template-body">
          <div className="template-name-field">
            <input
              type="text"
              placeholder="Notebook name (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="template-name-input"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          <div className="template-grid-container">
            {Object.entries(sizeGroups).map(([groupName, templates]) => (
              <div key={groupName} className="template-group">
                <label className="template-group-label">{groupName}</label>
                <div className="template-grid">
                  {templates.map(t => (
                    <button
                      key={t.id}
                      className={`template-card ${selectedTemplate === t.id ? 'selected' : ''}`}
                      onClick={() => setSelectedTemplate(t.id)}
                    >
                      <div
                        className={`template-preview template-bg-${t.background}`}
                        style={{ aspectRatio: `${t.width} / ${t.height}` }}
                      >
                        <span className="template-icon">{t.icon}</span>
                      </div>
                      <span className="template-name">{t.name}</span>
                      <span className="template-desc">{t.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="cover-picker-section">
            <label className="template-group-label">Notebook Cover</label>
            <div className="cover-picker-grid">
              <button
                className={`cover-option ${selectedCover === null ? 'selected' : ''}`}
                onClick={() => setSelectedCover(null)}
              >
                <div
                  className="cover-preview cover-solid"
                  style={{ backgroundColor: NOTEBOOK_TEMPLATES.find(t => t.id === selectedTemplate)?.coverColor || '#007AFF' }}
                />
                <span className="cover-label">Solid</span>
              </button>
              {COVER_IMAGES.map(cover => (
                <button
                  key={cover.id}
                  className={`cover-option ${selectedCover === cover.id ? 'selected' : ''}`}
                  onClick={() => setSelectedCover(cover.id)}
                >
                  <div
                    className="cover-preview"
                    style={{ backgroundImage: `url(${cover.src})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                  />
                  <span className="cover-label">{cover.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="template-footer">
          <button className="template-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="template-create-btn" onClick={handleCreate}>Create Notebook</button>
        </div>
      </div>
    </div>
  );
};
