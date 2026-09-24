import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BuildProfile, VENDOR_DIRECTORY, type CompilationResult, type CompilationSuccess } from '@runflux/compiler';

const REPOSITORY_MODULES = fileURLToPath(new URL('../../node_modules/', import.meta.url));

export interface ExportOptions {
  /** npm packages replaced by local directories, e.g. a fake database driver. */
  readonly packages?: Readonly<Record<string, string>>;
  /**
   * `all` links every package of the repository; `declared` only those the project's package.json
   * lists, as `npm install` would, so an undeclared import fails like it would for a user.
   */
  readonly dependencies?: 'all' | 'declared';
}

/** A process started in the project, with the output line that showed it was ready. */
export interface StartedProcess {
  readonly child: ChildProcess;
  readonly ready: RegExpExecArray;
}

/**
 * A compiled backend written to a temporary directory, as a user would unpack the download. Its
 * node_modules links to the repository's third-party packages, but `@runflux/runtime` resolves to
 * the project's own vendored bundle, never to the workspace source.
 */
export class ExportedProject {
  private readonly processes: ChildProcess[] = [];
  readonly directory: string;
  readonly result: CompilationSuccess;

  private constructor(directory: string, result: CompilationSuccess) {
    this.directory = directory;
    this.result = result;
  }

  static async write(result: CompilationResult, options: ExportOptions = {}): Promise<ExportedProject> {
    if (result.status !== 'success') throw new Error(`Compilation failed: ${result.error.code} ${result.error.message}`);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-exported-'));
    for (const file of result.files) {
      const target = path.join(directory, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content);
    }
    const project = new ExportedProject(directory, result);
    const declared = options.dependencies === 'declared' ? declaredPackages(project.json('package.json')) : undefined;
    await linkDependencies(directory, options.packages ?? {}, declared);
    return project;
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

  /** Starts `node <script>` in the project and resolves once its output matches `ready`. */
  start(script: string, env: Record<string, string>, ready: RegExp): Promise<StartedProcess> {
    const child = spawn(process.execPath, [script], { cwd: this.directory, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    this.processes.push(child);
    return new Promise((resolve, reject) => {
      let output = '';
      const collect = (chunk: Buffer) => {
        output += chunk;
        const match = ready.exec(output);
        if (match) resolve({ child, ready: match });
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

/** The packages `npm install` would install at the top of the project: its declared dependencies. */
function declaredPackages(manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): Set<string> {
  return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
}

/**
 * Links the repository's packages into the project's node_modules, together with its `.bin`, so
 * the scripts find esbuild and tsc. Linked packages resolve their own dependencies from the
 * repository, as npm's hoisting would.
 */
async function linkDependencies(directory: string, replacements: Readonly<Record<string, string>>, declared?: ReadonlySet<string>): Promise<void> {
  const modules = path.join(directory, 'node_modules');
  await fs.mkdir(path.join(modules, '@runflux'), { recursive: true });
  const link = async (name: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(modules, name)), { recursive: true });
    await fs.symlink(source, path.join(modules, name));
  };
  await link('.bin', path.join(REPOSITORY_MODULES, '.bin'));
  for (const name of await repositoryPackages()) {
    if (name.startsWith('@runflux/') || name in replacements || (declared && !declared.has(name))) continue;
    await link(name, path.join(REPOSITORY_MODULES, name));
  }
  for (const [name, source] of Object.entries(replacements)) await link(name, source);
  await fs.symlink(path.join(directory, VENDOR_DIRECTORY), path.join(modules, '@runflux', 'runtime'));
}

/** Package names at the top of the repository's node_modules, scoped ones as `@scope/name`. */
async function repositoryPackages(): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await fs.readdir(REPOSITORY_MODULES)) {
    if (entry.startsWith('.')) continue;
    if (!entry.startsWith('@')) {
      names.push(entry);
      continue;
    }
    for (const scoped of await fs.readdir(path.join(REPOSITORY_MODULES, entry))) names.push(`${entry}/${scoped}`);
  }
  return names;
}
