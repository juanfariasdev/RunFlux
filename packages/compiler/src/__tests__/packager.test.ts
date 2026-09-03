import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createZipPackage } from '../packager.js';
import type { GeneratedFile } from '../types.js';

describe('Zip Packager', () => {
  it('bundles generated files into a valid in-memory zip archive', async () => {
    const files: GeneratedFile[] = [
      { path: 'package.json', content: '{"name": "test"}', type: 'config' },
      { path: 'src/server.ts', content: 'console.log("hello");', type: 'source' },
      { path: 'docs/README.md', content: '# Readme', type: 'asset' },
    ];

    const zipBuffer = await createZipPackage(files);
    expect(zipBuffer).toBeInstanceOf(Uint8Array);
    expect(zipBuffer.length).toBeGreaterThan(50);

    const loadedZip = await JSZip.loadAsync(zipBuffer);
    expect(loadedZip.file('package.json')).toBeDefined();
    expect(loadedZip.file('src/server.ts')).toBeDefined();
    expect(loadedZip.file('docs/README.md')).toBeDefined();

    const serverContent = await loadedZip.file('src/server.ts')?.async('string');
    expect(serverContent).toBe('console.log("hello");');
  });
});
