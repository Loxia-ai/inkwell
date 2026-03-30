import React, { useState, useCallback, useEffect } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import { Canvas } from './components/Canvas';
import { Toolbar } from './components/toolbar/Toolbar';
import { Sidebar } from './components/sidebar/Sidebar';
import { Header } from './components/Header';
// PageNavigator is now integrated into Header
import { NotebookTemplateModal } from './components/NotebookTemplateModal';
import { exportToPDF } from './utils/pdfExport';
import './styles/global.css';

const AppContent: React.FC = () => {
  const { state, dispatch, getActiveNotebook } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          dispatch({ type: 'REDO' });
        } else {
          dispatch({ type: 'UNDO' });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);

  const handleNewNotebook = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleExportPDF = useCallback(async () => {
    const nb = getActiveNotebook();
    if (nb) {
      await exportToPDF(nb);
    }
  }, [getActiveNotebook]);

  const hasNotebook = state.activeNotebookId !== null;

  return (
    <div className="app">
      <Header
        onOpenSidebar={() => setSidebarOpen(true)}
        onExportPDF={handleExportPDF}
      />

      <div className="app-canvas-area">
        {hasNotebook ? (
          <Canvas />
        ) : (
          <div className="welcome">
            <img
              src="/illustrations/empty-state.png"
              alt="Open notebook"
              className="welcome-illustration"
            />
            <h1>Inkwell</h1>
            <p>A beautiful notebook for your iPad. Write, sketch, and create with precision.</p>
            <button className="welcome-btn" onClick={handleNewNotebook}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create Notebook
            </button>
          </div>
        )}
      </div>

      {hasNotebook && <Toolbar />}


      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewNotebook={handleNewNotebook}
      />

      <NotebookTemplateModal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
      />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default App;
