import React from 'react';
import { useApp } from '../store/AppContext';
import './Header.css';

interface HeaderProps {
  onOpenSidebar: () => void;
  onExportPDF: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar, onExportPDF }) => {
  const { state, getActiveNotebook } = useApp();
  const notebook = getActiveNotebook();

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
