import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // configDefaults.exclude already has "**/dist/**", but that pattern can
    // fail to match a *top-level* dist/ (a known picomatch "**" boundary
    // quirk) — add the root-relative forms explicitly so a stray `tsc -b`
    // output here never gets picked up as test files.
    exclude: [...configDefaults.exclude, 'dist/**', 'dist-node/**'],
  },
});
