import React from 'react';

interface SizeSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export const SizeSlider: React.FC<SizeSliderProps> = ({ value, onChange }) => {
  return (
    <div className="size-slider">
      <div className="size-preview">
        <div
          className="size-preview-dot"
          style={{
            width: Math.max(2, value * 3),
            height: Math.max(2, value * 3),
          }}
        />
      </div>
      <input
        type="range"
        min="0.5"
        max="20"
        step="0.5"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider-input"
      />
      <div className="size-labels">
        <span>Fine</span>
        <span>{value.toFixed(1)}</span>
        <span>Bold</span>
      </div>
    </div>
  );
};
