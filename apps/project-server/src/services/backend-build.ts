import fs from 'node:fs';
import path from 'node:path';
import { BuildProfile, createZipPackage, type CompilationSuccess } from '@runflux/compiler';

const FUNCTION_ZIP = 'function.zip';

/**
 * Writes a compiled project into `directory`, builds its `dist/` and adds its archives: the whole
 * project as `zipFilename` and, for AWS, the function package `function.zip`. Throws `buildFailed`'s
 * error when the build fails.
 */
export async function buildBackend(
  directory: string,
  result: CompilationSuccess,
  zipFilename: string,
  nodePaths: readonly string[],
  buildFailed: (error: unknown) => Error,
): Promise<void> {
  for (const file of result.files) {
    const filePath = path.join(directory, file.path);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, file.content, 'utf8');
  }
  try {
    await BuildProfile.fromManifest(result.manifest).build(directory, [...nodePaths]);
  } catch (error) {
    throw buildFailed(error);
  }
  const bundle = await readTree(path.join(directory, 'dist'));
  if (result.targetPlatform === 'aws') await fs.promises.writeFile(path.join(directory, FUNCTION_ZIP), await createZipPackage(bundle));
  await fs.promises.writeFile(
    path.join(directory, zipFilename),
    await createZipPackage([...result.files, ...bundle.map((file) => ({ ...file, path: `dist/${file.path}` }))]),
  );
}

async function readTree(directory: string, prefix = ''): Promise<Array<{ path: string; content: Buffer }>> {
  const entries = await fs.promises.readdir(path.join(directory, prefix), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return readTree(directory, relative);
    return [{ path: relative, content: await fs.promises.readFile(path.join(directory, relative)) }];
  }));
  return nested.flat();
}
