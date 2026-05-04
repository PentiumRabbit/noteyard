import React from "react";

/**
 * useResizable — 鼠标拖拽调整高度 hook
 *
 * @param defaultHeight  初始/默认高度（px）
 * @param minHeight      拖拽最小高度（px），默认 100
 * @param onHeightChange 高度变化回调，收到新高度（px 数值）
 */
export function useResizable(
  defaultHeight: number,
  minHeight: number = 100,
  onHeightChange?: (newHeight: number) => void,
) {
  const resizeRef = React.useRef<{ startY: number; startH: number } | null>(null);

  const startResize = (e: React.MouseEvent, currentHeight: number) => {
    e.preventDefault();
    const h = currentHeight || defaultHeight;
    resizeRef.current = { startY: e.clientY, startH: h };

    const onMove = (mv: MouseEvent) => {
      if (!resizeRef.current) return;
      const newH = Math.max(minHeight, resizeRef.current.startH + mv.clientY - resizeRef.current.startY);
      onHeightChange?.(newH);
    };

    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return { startResize };
}
