/**
 * Compute the Y position for a popover so it stays within the viewport.
 * If there's not enough room below the trigger, it opens upward instead.
 */
export function getPopoverY(
  triggerRect: DOMRect,
  estimatedHeight: number,
  offset = 4,
): number {
  return triggerRect.bottom + estimatedHeight + offset > window.innerHeight
    ? triggerRect.top - estimatedHeight - offset
    : triggerRect.bottom + offset;
}
