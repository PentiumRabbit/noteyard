import React, { useEffect, useRef, useState } from "react";
import "./CustomSelect.css";

interface CustomSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  className,
  placeholder,
  disabled,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentLabel =
    options.find((o) => o.value === value)?.label ??
    (value ? value : (placeholder ?? "请选择…"));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div className={`custom-select${className ? ` ${className}` : ""}`} ref={ref}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={`custom-select-trigger${open ? " open" : ""}${disabled ? " disabled" : ""}`}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); }
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <span>{currentLabel}</span>
        <span className="custom-select-arrow">▾</span>
      </div>
      {open && (
        <div className="custom-select-menu">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`custom-select-option${opt.value === value ? " selected" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
