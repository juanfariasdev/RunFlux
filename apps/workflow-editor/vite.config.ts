import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { runfluxPluginCatalogPlugin } from './vite-plugin-plugin-catalog.ts';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), runfluxPluginCatalogPlugin(['../../plugins'])],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
