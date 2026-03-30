import React from 'react';

const PRESET_COLORS = [
  '#000000', '#3C3C43', '#8E8E93',
  '#007AFF', '#5856D6', '#AF52DE',
  '#FF2D55', '#FF3B30', '#FF9500',
  '#FFCC00', '#34C759', '#00C7BE',
  '#30B0C7', '#5AC8FA', '#FFFFFF',
];

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange }) => {
  return (
    <div className="color-picker">
      <div className="color-grid">
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            className={`color-swatch ${c === color ? 'selected' : ''}`}
            style={{ backgroundColor: c, border: c === '#FFFFFF' ? '1px solid #E5E5EA' : 'none' }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
      <div className="color-custom">
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          className="color-input"
        />
        <span className="color-hex">{color.toUpperCase()}</span>
      </div>
    </div>
  );
};
