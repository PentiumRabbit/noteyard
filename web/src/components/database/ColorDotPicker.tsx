interface ColorEntry {
  bg: string;
  text: string;
}

interface ColorDotPickerProps {
  colors: ColorEntry[];
  value: number;
  onChange: (idx: number) => void;
}

/**
 * A row of small color dots used to pick an option color.
 * Renders each entry in `colors` as a circular button; the active index
 * receives the `.color-dot-notion.active` highlight ring.
 */
export function ColorDotPicker({ colors, value, onChange }: ColorDotPickerProps) {
  return (
    <div className="select-opt-colors">
      {colors.map((c, ci) => (
        <button
          key={ci}
          type="button"
          className={`color-dot-notion${value === ci ? " active" : ""}`}
          style={{ background: c.text }}
          onClick={() => onChange(ci)}
        />
      ))}
    </div>
  );
}
