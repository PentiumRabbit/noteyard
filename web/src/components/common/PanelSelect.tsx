import React from "react";

interface PanelSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

export function PanelSelect({ label, value, onChange, options }: PanelSelectProps) {
  return (
    <label className="panel-select-label">
      {label}
      <select
        className="panel-select"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}
