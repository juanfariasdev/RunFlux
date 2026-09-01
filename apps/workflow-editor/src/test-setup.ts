import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.ResizeObserver = globalThis.ResizeObserver || (MockResizeObserver as unknown as typeof ResizeObserver);

afterEach(() => {
  cleanup();
});
