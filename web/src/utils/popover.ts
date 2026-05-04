/**
 * Compute the Y position for a popover so it stays within the viewport.
 * Direction (up/down) is chosen using half the viewport height as a conservative
 * threshold — the actual popover height is capped by CSS max-height so it never
 * overflows regardless of the estimate.
 */
export function getPopoverY(
  triggerRect: DOMRect,
  _estimatedHeight?: number,
  offset = 4,
): number {
  const threshold = window.innerHeight / 2;
  return triggerRect.bottom + threshold > window.innerHeight
    ? triggerRect.top - offset
    : triggerRect.bottom + offset;
}
