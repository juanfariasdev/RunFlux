import { useEffect } from 'react';

interface CanvasShortcutActions {
  readonly undo: () => void;
  readonly redo: () => void;
  /** Returns whether something was copied, so an empty selection leaves the browser's copy alone. */
  readonly copySelection: () => boolean;
  readonly pasteClipboard: () => boolean;
  readonly selectAll: () => void;
  /** Called after undo and redo, which drop the selection. */
  readonly clearSelection: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}

/**
 * Ctrl/Cmd shortcuts of the canvas: Z undo (Shift+Z redo), Y redo, C copy, V paste, A select all.
 * Typing in a field keeps the browser's own shortcuts.
 */
export function useCanvasShortcuts({ undo, redo, copySelection, pasteClipboard, selectAll, clearSelection }: CanvasShortcutActions): void {
  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();

      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        clearSelection();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        redo();
        clearSelection();
        return;
      }
      if (key === 'c') {
        if (!copySelection()) return;
        event.preventDefault();
        return;
      }
      if (key === 'v') {
        if (!pasteClipboard()) return;
        event.preventDefault();
        return;
      }
      if (key === 'a') {
        event.preventDefault();
        selectAll();
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [clearSelection, copySelection, pasteClipboard, redo, selectAll, undo]);
}
