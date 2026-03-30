import React from 'react';
import { useApp } from '../store/AppContext';
import './Header.css';

interface HeaderProps {
  onOpenSidebar: () => void;
  onExportPDF: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar, onExportPDF }) => {
  const { state, dispatch, getActiveNotebook, persistNotebook } = useApp();
  const notebook = getActiveNotebook();

  const totalPages = notebook ? notebook.pages.length : 0;
  const currentPage = state.activePageIndex + 1;

  const goToPrev = () => {
    if (state.activePageIndex > 0) {
      dispatch({ type: 'SET_ACTIVE_PAGE', index: state.activePageIndex - 1 });
    }
  };

  const goToNext = () => {
    if (state.activePageIndex < totalPages - 1) {
      dispatch({ type: 'SET_ACTIVE_PAGE', index: state.activePageIndex + 1 });
    }
  };

  const addPage = () => {
    dispatch({ type: 'ADD_PAGE', afterIndex: state.activePageIndex });
    setTimeout(() => {
      const nb = getActiveNotebook();
      if (nb) persistNotebook(nb);
    }, 50);
  };

  const deletePage = () => {
    if (totalPages <= 1) return;
    dispatch({ type: 'DELETE_PAGE', index: state.activePageIndex });
    const nb = getActiveNotebook();
    if (nb) persistNotebook(nb);
  };

  return (
    <div className="header">
      <div className="header-left">
        <button className="header-btn" onClick={onOpenSidebar} title="Notebooks">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <a
          href="https://onbuzz.loxia.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="header-brand"
          title="Built with OnBuzz by Loxia"
        >
          <img
            src="/logo.webp"
            alt="OnBuzz"
            className="brand-logo-img"
            width="28"
            height="28"
          />
          <span className="brand-label">
            <span className="brand-label-top">Built with</span>
            <img
              src="/logo-text.webp"
              alt="OnBuzz"
              className="brand-text-img"
              height="14"
            />
            <span className="brand-label-bottom">by Loxia</span>
          </span>
        </a>
      </div>
      <h1 className="header-title">
        {notebook ? notebook.title : 'Inkwell'}
      </h1>
      <div className="header-right">
        {/* Page navigator — inline in header */}
        {notebook && (
          <div className="header-page-nav">
            <button className="header-page-btn" onClick={goToPrev} disabled={state.activePageIndex === 0} title="Previous page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="header-page-label">
              {currentPage}/{totalPages}
            </span>
            <button className="header-page-btn" onClick={goToNext} disabled={state.activePageIndex >= totalPages - 1} title="Next page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button className="header-page-btn add" onClick={addPage} title="Add page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button className="header-page-btn" onClick={deletePage} disabled={totalPages <= 1} title="Delete page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        )}
        {notebook && (
          <button className="header-btn" onClick={onExportPDF} title="Export PDF">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 18 15 15" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
