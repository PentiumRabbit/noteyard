import React from "react";
import CustomSelect from "./CustomSelect";

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
      <CustomSelect
        value={value}
        onChange={onChange}
        options={options}
      />
    </label>
  );
}
