import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type ContextMenuState = { x: number; y: number } | undefined;

/**
 * The canvas context menu: opened at a pointer position inside the canvas, closed by a pointer
 * down outside it or by Escape.
 */
export function useContextMenu(canvasRef: RefObject<HTMLDivElement | null>) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const openContextMenu = useCallback((clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    setContextMenu({
      x: Math.max(8, clientX - (bounds?.left ?? 0)),
      y: Math.max(8, clientY - (bounds?.top ?? 0)),
    });
  }, [canvasRef]);

  const closeContextMenu = useCallback(() => setContextMenu(undefined), []);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as globalThis.Node | null)) setContextMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(undefined);
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return { contextMenu, contextMenuRef, openContextMenu, closeContextMenu };
}
