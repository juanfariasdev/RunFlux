import JSZip from 'jszip';

export async function createZipPackage(files: Array<{ path: string; content: string | Uint8Array }>): Promise<Uint8Array> {
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
