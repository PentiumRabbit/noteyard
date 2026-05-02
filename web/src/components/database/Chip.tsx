import { X } from "lucide-react";

/** One color entry — bg is the background tint, text is the foreground color. */
interface ColorEntry {
  bg: string;
  text: string;
}

interface ChipProps {
  /** Display text of the chip. */
  label: string;
  /**
   * Index into an external color palette.
   * When provided the chip receives the bg/text colors from that index.
   * When omitted the chip renders with the default `.cell-tag` appearance
   * (caller can pass inline `style` instead if needed).
   */
  colorIdx?: number;
  /** Color palette to resolve `colorIdx` against. */
  colors?: ColorEntry[];
  /** When provided a × button is rendered; clicking it calls this handler. */
  onRemove?: () => void;
  /**
   * When provided the chip label is wrapped in an `<a>` element.
   * Useful for phone (`tel:`) and URL fields.
   */
  href?: string;
}

/**
 * A small colored label chip.
 *
 * Used by select tags, multi-select tags, people chips, phone chips,
 * and relation tags throughout the database views.
 */
export function Chip({
  label,
  colorIdx,
  colors,
  onRemove,
  href,
}: ChipProps) {
  const colorStyle =
    colorIdx !== undefined && colors !== undefined
      ? { background: colors[colorIdx % colors.length].bg, color: colors[colorIdx % colors.length].text }
      : undefined;

  const inner = href ? (
    <a href={href} className="chip-href" onClick={e => e.stopPropagation()}>
      {label}
    </a>
  ) : (
    <>{label}</>
  );

  return (
    <span className="cell-tag" style={colorStyle}>
      {inner}
      {onRemove && (
        <button
          type="button"
          className="chip-remove"
          onClick={e => { e.stopPropagation(); onRemove(); }}
          tabIndex={-1}
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}
