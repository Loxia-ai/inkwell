import React, { useState, useRef, useCallback } from 'react';
import { useApp } from '../../store/AppContext';
import { ToolType, ShapeType, PageBackground, PageImage } from '../../types';
import { ColorPicker } from './ColorPicker';
import { SizeSlider } from './SizeSlider';
import { v4 as uuid } from 'uuid';
import './Toolbar.css';

const TOOLS: { id: ToolType; icon: string; label: string }[] = [
  { id: 'pen', icon: '✒️', label: 'Pen' },
  { id: 'pencil', icon: '✏️', label: 'Pencil' },
  { id: 'fountain', icon: '🖋️', label: 'Fountain' },
  { id: 'calligraphy', icon: '𝒜', label: 'Calligr.' },
  { id: 'highlighter', icon: '🖍️', label: 'Highlight' },
  { id: 'marker', icon: '🖌️', label: 'Marker' },
  { id: 'spray', icon: '💨', label: 'Spray' },
  { id: 'eraser', icon: '🧹', label: 'Eraser' },
  { id: 'shape', icon: '⬜', label: 'Shapes' },
  { id: 'ruler', icon: '📏', label: 'Ruler' },
];

const SHAPES: { id: ShapeType; icon: string; label: string }[] = [
  { id: 'line', icon: '╱', label: 'Line' },
  { id: 'rectangle', icon: '▭', label: 'Rectangle' },
  { id: 'circle', icon: '○', label: 'Circle' },
  { id: 'arrow', icon: '→', label: 'Arrow' },
];

const BACKGROUNDS: { id: PageBackground; icon: string; label: string }[] = [
  { id: 'blank', icon: '▢', label: 'Blank' },
  { id: 'lined', icon: '☰', label: 'Lined' },
  { id: 'grid', icon: '⊞', label: 'Grid' },
  { id: 'dotted', icon: '⠿', label: 'Dotted' },
  { id: 'graph', icon: '📊', label: 'Graph' },
  { id: 'cornell', icon: '🎓', label: 'Cornell' },
  { id: 'isometric', icon: '🔷', label: 'Iso' },
  { id: 'music', icon: '🎵', label: 'Music' },
];

export const Toolbar: React.FC = () => {
  const { state, dispatch, getActivePage, getActiveNotebook, persistNotebook } = useApp();
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSizeSlider, setShowSizeSlider] = useState(false);
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showBgMenu, setShowBgMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const closeAll = () => {
    setShowColorPicker(false);
    setShowSizeSlider(false);
    setShowShapeMenu(false);
    setShowBgMenu(false);
    setShowMoreMenu(false);
  };

  const handleToolSelect = (tool: ToolType) => {
    closeAll();
    if (tool === 'ruler') {
      dispatch({ type: 'SET_RULER_VISIBLE', visible: !state.ruler.visible });
      return;
    }
    if (tool === 'shape') {
      dispatch({ type: 'SET_TOOL', tool: 'shape' });
      setShowShapeMenu(!showShapeMenu);
      return;
    }
    dispatch({ type: 'SET_TOOL', tool });
  };

  const handleUndo = () => dispatch({ type: 'UNDO' });
  const handleRedo = () => dispatch({ type: 'REDO' });

  const handleImageInsert = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleImageSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const page = getActivePage();
    if (!page) return;

    // Read file as data URL
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return;

      // Get image dimensions
      const img = new Image();
      img.onload = () => {
        // Scale to fit within reasonable bounds
        const maxDim = 400;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w *= scale;
          h *= scale;
        }

        const pageImage: PageImage = {
          id: uuid(),
          src,
          x: (page.width - w) / 2,
          y: (page.height - h) / 2,
          width: w,
          height: h,
          rotation: 0,
          opacity: 1,
        };

        dispatch({ type: 'ADD_IMAGE', pageId: page.id, image: pageImage });
        const nb = getActiveNotebook();
        if (nb) persistNotebook(nb);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);

    // Reset input
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, [getActivePage, getActiveNotebook, dispatch, persistNotebook]);

  const page = getActivePage();

  return (
    <div className="toolbar">
      <div className="toolbar-section toolbar-left">
        <button
          className="toolbar-btn"
          onClick={handleUndo}
          disabled={state.undoStack.length === 0}
          title="Undo"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleRedo}
          disabled={state.redoStack.length === 0}
          title="Redo"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
          </svg>
        </button>
      </div>

      <div className="toolbar-section toolbar-center">
        {TOOLS.map(tool => (
          <button
            key={tool.id}
            className={`toolbar-btn tool-btn ${
              (tool.id === 'ruler' && state.ruler.visible) ||
              (tool.id !== 'ruler' && state.activeTool === tool.id)
                ? 'active'
                : ''
            }`}
            onClick={() => handleToolSelect(tool.id)}
            title={tool.label}
          >
            <span className="tool-icon">{tool.icon}</span>
            <span className="tool-label">{tool.label}</span>
          </button>
        ))}

        {/* Shape submenu */}
        {showShapeMenu && (
          <div className="toolbar-popover shape-popover">
            {SHAPES.map(shape => (
              <button
                key={shape.id}
                className={`popover-btn ${state.activeShape === shape.id ? 'active' : ''}`}
                onClick={() => {
                  dispatch({ type: 'SET_SHAPE', shape: shape.id });
                  setShowShapeMenu(false);
                }}
              >
                <span>{shape.icon}</span>
                <span>{shape.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar-section toolbar-right">
        {/* Image insert */}
        <button
          className="toolbar-btn"
          onClick={handleImageInsert}
          title="Insert Image"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelected}
          style={{ display: 'none' }}
        />

        {/* Color indicator */}
        <button
          className="toolbar-btn color-btn"
          onClick={() => { closeAll(); setShowColorPicker(!showColorPicker); }}
          title="Color"
        >
          <div
            className="color-indicator"
            style={{ backgroundColor: state.strokeStyle.color }}
          />
        </button>

        {/* Size */}
        <button
          className="toolbar-btn"
          onClick={() => { closeAll(); setShowSizeSlider(!showSizeSlider); }}
          title="Size"
        >
          <div className="size-indicator">
            <div
              className="size-dot"
              style={{
                width: Math.min(18, state.strokeStyle.width * 3),
                height: Math.min(18, state.strokeStyle.width * 3),
              }}
            />
          </div>
        </button>

        {/* More menu */}
        <button
          className="toolbar-btn"
          onClick={() => { closeAll(); setShowMoreMenu(!showMoreMenu); }}
          title="More"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        {/* Popovers */}
        {showColorPicker && (
          <div className="toolbar-popover color-popover">
            <ColorPicker
              color={state.strokeStyle.color}
              onChange={(color) => dispatch({ type: 'SET_STROKE_STYLE', style: { color } })}
            />
          </div>
        )}

        {showSizeSlider && (
          <div className="toolbar-popover size-popover">
            <SizeSlider
              value={state.strokeStyle.width}
              onChange={(width) => dispatch({ type: 'SET_STROKE_STYLE', style: { width } })}
            />
          </div>
        )}

        {showMoreMenu && (
          <div className="toolbar-popover more-popover">
            <div className="popover-group">
              <label className="popover-label">Background</label>
              <div className="popover-row popover-row-wrap">
                {BACKGROUNDS.map(bg => (
                  <button
                    key={bg.id}
                    className={`popover-btn ${page?.background === bg.id ? 'active' : ''}`}
                    onClick={() => {
                      if (page) dispatch({ type: 'SET_PAGE_BACKGROUND', pageId: page.id, bg: bg.id });
                    }}
                  >
                    <span>{bg.icon}</span>
                    <span>{bg.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="popover-group">
              <label className="popover-label">Palm Rejection</label>
              <button
                className={`popover-toggle ${state.palmRejection ? 'on' : ''}`}
                onClick={() => dispatch({ type: 'SET_PALM_REJECTION', enabled: !state.palmRejection })}
              >
                <div className="toggle-track">
                  <div className="toggle-thumb" />
                </div>
                <span>{state.palmRejection ? 'On' : 'Off'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
