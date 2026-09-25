import fs from 'node:fs';
import path from 'node:path';

const COMPILATION_ID = /^[A-Za-z0-9_-]+-(local|aws)-\d+-[0-9a-f]{8}$/;

/**
 * The output directory of compiled backends: one folder per compilation, written under a
 * temporary name and renamed once complete, so concurrent compilations never mix files. Only the
 * latest folder of each project and target is kept.
 */
export class CompilationFolders {
  private readonly root: () => string;

  /** `root` is read on every call, since the output directory may depend on the environment. */
  constructor(root: () => string) {
    this.root = root;
  }

  /**
   * Runs `fill` on an empty staging folder and, when it succeeds, moves the folder into place as
   * the compilation's folder, whose path it returns. The staging folder never outlives the call.
   */
  async write(compilationId: string, fill: (staging: string) => Promise<void>): Promise<string> {
    const folder = path.join(this.root(), compilationId);
    const staging = `${folder}.partial`;
    try {
      await fill(staging);
      await fs.promises.rename(staging, folder);
      return folder;
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * The archive `filename` of a compilation, or of the latest compilation that produced it when
   * no compilation is named. Names are checked, so no request reaches outside the output folder.
   */
  async findArchive(filename: string, compilationId?: string): Promise<string | null> {
    if (filename !== path.basename(filename) || filename.includes('\\') || !filename.endsWith('.zip')) return null;
    if (compilationId !== undefined && !COMPILATION_ID.test(compilationId)) return null;
    const folders = compilationId ? [compilationId] : (await this.list()).reverse();
    for (const folder of folders) {
      const candidate = path.join(this.root(), folder, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  /**
   * Removes the compilations of the same project and target (`key`) that started before `keep`;
   * one that started later, concurrently, is newer and stays.
   */
  async removeEarlier(key: string, keep: string): Promise<void> {
    const earlier = (await this.list()).filter((folder) => folder !== keep
      && /^\d+-[0-9a-f]{8}$/.test(folder.slice(key.length + 1))
      && folder.startsWith(`${key}-`)
      && timestampOf(folder) <= timestampOf(keep));
    await Promise.all(earlier.map((folder) => fs.promises.rm(path.join(this.root(), folder), { recursive: true, force: true })));
  }

  /** Completed compilation folders, oldest first. */
  private async list(): Promise<string[]> {
    const entries = await fs.promises.readdir(this.root(), { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory() && COMPILATION_ID.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => timestampOf(a) - timestampOf(b));
  }
}

function timestampOf(compilationId: string): number {
  return Number(/-(\d+)-[0-9a-f]{8}$/.exec(compilationId)?.[1] ?? 0);
}
