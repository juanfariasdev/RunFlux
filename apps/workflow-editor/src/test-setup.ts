import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.ResizeObserver = globalThis.ResizeObserver || (MockResizeObserver as unknown as typeof ResizeObserver);

if (typeof window !== 'undefined' && !window.DOMMatrixReadOnly) {
  Object.defineProperty(window, 'DOMMatrixReadOnly', {
    configurable: true,
    value: class {
      m22 = 1;
      constructor(_transform?: string) {}
    },
  });
}

afterEach(() => {
  cleanup();
});
