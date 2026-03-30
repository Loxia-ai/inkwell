import React from 'react';
import { useApp } from '../store/AppContext';
// db imports handled via context
import './PageNavigator.css';

export const PageNavigator: React.FC = () => {
  const { state, dispatch, getActiveNotebook, persistNotebook } = useApp();
  const notebook = getActiveNotebook();

  if (!notebook) return null;

  const totalPages = notebook.pages.length;
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
    // Persist
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
    <div className="page-nav">
      <button className="page-nav-btn" onClick={goToPrev} disabled={state.activePageIndex === 0}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="page-nav-label">
        {currentPage} / {totalPages}
      </span>
      <button className="page-nav-btn" onClick={goToNext} disabled={state.activePageIndex >= totalPages - 1}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <button className="page-nav-btn add" onClick={addPage} title="Add page">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button className="page-nav-btn" onClick={deletePage} disabled={totalPages <= 1} title="Delete page">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
};
