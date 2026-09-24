import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BuildProfile, VENDOR_DIRECTORY, type CompilationResult, type CompilationSuccess } from '@runflux/compiler';

const REPOSITORY_MODULES = path.resolve('node_modules');

export interface ExportOptions {
  /** npm packages replaced by local directories, e.g. a fake database driver. */
  readonly packages?: Readonly<Record<string, string>>;
}

/**
 * A compiled backend written to a temporary directory, as a user would unpack the download. Its
 * node_modules links to the repository's third-party packages, but `@runflux/runtime` resolves to
 * the project's own vendored bundle, never to the workspace source.
 */
export class ExportedProject {
  private readonly processes: ChildProcess[] = [];

  private constructor(
    readonly directory: string,
    readonly result: CompilationSuccess,
  ) {}

  static async write(result: CompilationResult, options: ExportOptions = {}): Promise<ExportedProject> {
    if (result.status !== 'success') throw new Error(`Compilation failed: ${result.error.code} ${result.error.message}`);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-exported-'));
    for (const file of result.files) {
      const target = path.join(directory, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content);
    }
    await linkDependencies(directory, options.packages ?? {});
    return new ExportedProject(directory, result);
  }

  /** Bundles the entry points into dist/, exactly as the download is built. */
  async build(): Promise<this> {
    await BuildProfile.fromManifest(this.result.manifest).build(this.directory);
    return this;
  }

  import<TModule = any>(file: string): Promise<TModule> {
    return import(pathToFileURL(path.join(this.directory, file)).href);
  }

  /** A module of the vendored runtime, e.g. `index` or `express`. */
  runtime<TModule = any>(name: string): Promise<TModule> {
    return this.import(`${VENDOR_DIRECTORY}/${name}.js`);
  }

  /** The workflow engine the backend's entry points create, built from the vendored runtime. */
  async engine() {
    const [{ WorkflowEngine }, { plugins }] = await Promise.all([this.runtime('index'), this.runtime('plugins')]);
    return WorkflowEngine.fromDocument(this.json('src/workflow.json'), plugins);
  }

  /** Starts `node <script>` in the project and resolves once it prints `ready`. */
  start(script: string, env: Record<string, string>, ready: RegExp): Promise<ChildProcess> {
    const child = spawn(process.execPath, [script], { cwd: this.directory, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    this.processes.push(child);
    return new Promise((resolve, reject) => {
      let output = '';
      const collect = (chunk: Buffer) => {
        output += chunk;
        if (ready.test(output)) resolve(child);
      };
      child.stdout!.on('data', collect);
      child.stderr!.on('data', collect);
      child.once('exit', (code) => reject(new Error(`${script} exited with ${code}: ${output}`)));
    });
  }

  text(file: string): string {
    const found = this.result.files.find((candidate) => candidate.path === file);
    if (!found) throw new Error(`The project has no ${file}`);
    return found.content;
  }

  json<TValue = any>(file: string): TValue {
    return JSON.parse(this.text(file));
  }

  paths(): string[] {
    return this.result.files.map((file) => file.path);
  }

  async dispose(): Promise<void> {
    for (const child of this.processes) child.kill();
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}

async function linkDependencies(directory: string, replacements: Readonly<Record<string, string>>): Promise<void> {
  const modules = path.join(directory, 'node_modules');
  await fs.mkdir(path.join(modules, '@runflux'), { recursive: true });
  for (const entry of await fs.readdir(REPOSITORY_MODULES)) {
    if (entry === '@runflux' || entry.startsWith('.') || entry in replacements) continue;
    await fs.symlink(path.join(REPOSITORY_MODULES, entry), path.join(modules, entry));
  }
  for (const [name, source] of Object.entries(replacements)) await fs.symlink(source, path.join(modules, name));
  await fs.symlink(path.join(directory, VENDOR_DIRECTORY), path.join(modules, '@runflux', 'runtime'));
}
