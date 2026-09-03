import JSZip from 'jszip';
import type { GeneratedFile } from './types.js';

export async function createZipPackage(files: GeneratedFile[]): Promise<Uint8Array> {
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.path, file.content);
  }

  const buffer = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 6,
    },
  });

  return buffer;
}

export const createZipArchive = createZipPackage;
